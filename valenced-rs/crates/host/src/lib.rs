use std::collections::BTreeMap;
use valenced_core::json::Json;
use valenced_core::lifecycle::{Dispatcher, Event, Filter, HandlerId, Registry};
use valenced_core::manifest::Manifest;
use valenced_core::storage::Storage;
use valenced_core::Error;

pub struct HostApi {
	pub log: Vec<String>,
	pub storage: Storage,
	pub settings: Json,
}

impl HostApi {
	pub fn new(default_storage: Json) -> HostApi {
		HostApi {
			log: Vec::new(),
			storage: Storage::new(default_storage),
			settings: Json::obj(),
		}
	}

	pub fn info(&mut self, message: impl Into<String>) {
		self.log.push(message.into());
	}

	pub fn storage_get(&self, key: &str) -> Json {
		self.storage.get().get(key).cloned().unwrap_or(Json::Null)
	}

	pub fn storage_set(&mut self, key: &str, value: Json) {
		let mut patch = Json::obj();
		patch.set(key, value);
		self.storage.set(&patch, false);
	}
}

pub struct StartCtx<'a> {
	pub api: &'a mut HostApi,
	pub(crate) dispatcher: &'a mut Dispatcher,
	pub(crate) methods: &'a mut BTreeMap<String, usize>,
	pub(crate) owner: usize,
	pub(crate) handlers: &'a mut Vec<HandlerId>,
}

impl StartCtx<'_> {
	pub fn on(&mut self, filter: Filter) -> HandlerId {
		let id = self.dispatcher.on(filter);
		self.handlers.push(id);
		id
	}

	pub fn method(&mut self, name: impl Into<String>) {
		self.methods.insert(name.into(), self.owner);
	}
}

pub trait Guest {
	fn start(&mut self, ctx: &mut StartCtx<'_>) -> Result<(), Error>;
	fn handle(
		&mut self,
		api: &mut HostApi,
		handler: HandlerId,
		event: &Event,
	) -> Result<(), Error>;
	fn call(&mut self, api: &mut HostApi, method: &str, args: &Json) -> Result<Json, Error>;
	fn stop(&mut self, api: &mut HostApi) -> Result<(), Error>;
}

pub struct Delivery {
	pub plugin: String,
	pub handler: HandlerId,
}

struct Slot {
	manifest: Manifest,
	api: HostApi,
	guest: Box<dyn Guest>,
	handlers: Vec<HandlerId>,
	started: bool,
}

pub struct Runtime {
	registry: Registry,
	dispatcher: Dispatcher,
	methods: BTreeMap<String, usize>,
	handler_owner: BTreeMap<HandlerId, usize>,
	plugins: Vec<Slot>,
}

impl Runtime {
	pub fn new() -> Runtime {
		Runtime {
			registry: Registry::new(),
			dispatcher: Dispatcher::new(),
			methods: BTreeMap::new(),
			handler_owner: BTreeMap::new(),
			plugins: Vec::new(),
		}
	}

	pub fn load(
		&mut self,
		manifest: Manifest,
		guest: Box<dyn Guest>,
		default_storage: Json,
	) -> Result<(), Error> {
		self.registry.register(manifest.id.clone())?;
		self.plugins.push(Slot {
			manifest,
			api: HostApi::new(default_storage),
			guest,
			handlers: Vec::new(),
			started: false,
		});
		Ok(())
	}

	pub fn start(&mut self, id: &str) -> Result<(), Error> {
		let index = self.index_of(id)?;
		let slot = &mut self.plugins[index];
		let mut ctx = StartCtx {
			api: &mut slot.api,
			dispatcher: &mut self.dispatcher,
			methods: &mut self.methods,
			owner: index,
			handlers: &mut slot.handlers,
		};
		match slot.guest.start(&mut ctx) {
			Ok(()) => {
				for handler in ctx.handlers.iter() {
					self.handler_owner.insert(*handler, index);
				}
				slot.started = true;
				self.registry
					.set_phase(id, valenced_core::lifecycle::Phase::Started)
			}
			Err(error) => {
				self.registry.set_error(id, error.message());
				Err(error)
			}
		}
	}

	pub fn stop(&mut self, id: &str) -> Result<(), Error> {
		let index = self.index_of(id)?;
		let slot = &mut self.plugins[index];
		let result = slot.guest.stop(&mut slot.api);
		for handler in slot.handlers.drain(..) {
			self.dispatcher.off(handler);
			self.handler_owner.remove(&handler);
		}
		self.methods.retain(|_, owner| *owner != index);
		slot.started = false;
		self.registry
			.set_phase(id, valenced_core::lifecycle::Phase::Stopped)?;
		result
	}

	pub fn emit(&mut self, event: &Event) -> Result<Vec<Delivery>, Error> {
		let handlers = self.dispatcher.dispatch(event);
		let mut deliveries = Vec::new();
		for handler in handlers {
			let index = match self.handler_owner.get(&handler) {
				Some(index) => *index,
				None => continue,
			};
			let slot = &mut self.plugins[index];
			if !slot.started {
				continue;
			}
			let name = slot.manifest.id.clone();
			match slot.guest.handle(&mut slot.api, handler, event) {
				Ok(()) => deliveries.push(Delivery {
					plugin: name,
					handler,
				}),
				Err(error) => {
					self.registry.set_error(&name, error.message());
					return Err(error);
				}
			}
		}
		Ok(deliveries)
	}

	pub fn call(&mut self, method: &str, args: &Json) -> Result<Json, Error> {
		let index = *self
			.methods
			.get(method)
			.ok_or_else(|| Error::new(format!("host: no method {method}")))?;
		let slot = &mut self.plugins[index];
		slot.guest.call(&mut slot.api, method, args)
	}

	pub fn errors(&self) -> Vec<(String, String)> {
		self.registry
			.ids()
			.into_iter()
			.filter_map(|id| {
				self.registry
					.error(&id)
					.map(|message| (id, message.to_string()))
			})
			.collect()
	}

	pub fn phase(&self, id: &str) -> Result<valenced_core::lifecycle::Phase, Error> {
		self.registry.phase(id)
	}

	pub fn api(&self, id: &str) -> Option<&HostApi> {
		let index = self.index_of(id).ok()?;
		Some(&self.plugins[index].api)
	}

	pub fn api_mut(&mut self, id: &str) -> Option<&mut HostApi> {
		let index = self.index_of(id).ok()?;
		Some(&mut self.plugins[index].api)
	}

	pub fn manifest(&self, id: &str) -> Option<&Manifest> {
		let index = self.index_of(id).ok()?;
		Some(&self.plugins[index].manifest)
	}

	fn index_of(&self, id: &str) -> Result<usize, Error> {
		self.plugins
			.iter()
			.position(|slot| slot.manifest.id == id)
			.ok_or_else(|| Error::new(format!("host: unknown plugin {id}")))
	}
}

impl Default for Runtime {
	fn default() -> Runtime {
		Runtime::new()
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use valenced_core::lifecycle::Phase;
	use valenced_core::manifest::Manifest;

	struct MockGuest {
		lines: Vec<String>,
	}

	impl MockGuest {
		fn new() -> MockGuest {
			MockGuest {
				lines: Vec::new(),
			}
		}
	}

	impl Guest for MockGuest {
		fn start(&mut self, ctx: &mut StartCtx<'_>) -> Result<(), Error> {
			ctx.on(Filter::named("gateway.messageCreate"));
			ctx.method("mock.echo");
			ctx.api.info("started");
			Ok(())
		}

		fn handle(
			&mut self,
			api: &mut HostApi,
			_handler: HandlerId,
			event: &Event,
		) -> Result<(), Error> {
			let author = event
				.payload
				.get("author")
				.and_then(|v| v.as_str())
				.unwrap_or("unknown")
				.to_string();
			self.lines.push(author.clone());
			api.storage_set("lastAuthor", Json::from(author));
			Ok(())
		}

		fn call(&mut self, _api: &mut HostApi, method: &str, args: &Json) -> Result<Json, Error> {
			match method {
				"mock.echo" => Ok(args.clone()),
				other => Err(Error::new(format!("mock: unknown method {other}"))),
			}
		}

		fn stop(&mut self, api: &mut HostApi) -> Result<(), Error> {
			api.info("stopped");
			Ok(())
		}
	}

	fn manifest(id: &str) -> Manifest {
		Manifest::from_str(&format!(
			r#"{{"format": 1, "id": "{id}", "version": "1.0.0", "dist": {{"script": "index.js"}}}}"#
		))
		.unwrap()
	}

	#[test]
	fn lifecycle_event_storage_roundtrip() {
		let mut runtime = Runtime::new();
		runtime
			.load(manifest("a.b"), Box::new(MockGuest::new()), Json::obj())
			.unwrap();
		assert_eq!(runtime.phase("a.b").unwrap(), Phase::Registered);

		let early = runtime.emit(&Event::new("gateway.messageCreate", Json::obj())).unwrap();
		assert!(early.is_empty());

		runtime.start("a.b").unwrap();
		let mut payload = Json::obj();
		payload.set("author", Json::from("shin"));
		let deliveries = runtime
			.emit(&Event::new("gateway.messageCreate", payload))
			.unwrap();
		assert_eq!(deliveries.len(), 1);
		assert_eq!(deliveries[0].plugin, "a.b");

		let api = runtime.api("a.b").unwrap();
		assert_eq!(api.storage_get("lastAuthor").as_str(), Some("shin"));
		assert_eq!(api.log, vec!["started".to_string()]);

		let echoed = runtime.call("mock.echo", &Json::from("hi")).unwrap();
		assert_eq!(echoed.as_str(), Some("hi"));

		runtime.stop("a.b").unwrap();
		assert_eq!(runtime.phase("a.b").unwrap(), Phase::Stopped);
		let after = runtime.emit(&Event::new("gateway.messageCreate", Json::obj())).unwrap();
		assert!(after.is_empty());
		assert!(runtime.call("mock.echo", &Json::Null).is_err());
		assert_eq!(
			runtime.api("a.b").unwrap().log,
			vec!["started".to_string(), "stopped".to_string()]
		);
	}

	struct FailingGuest;

	impl Guest for FailingGuest {
		fn start(&mut self, _ctx: &mut StartCtx<'_>) -> Result<(), Error> {
			Err(Error::new("boot failure"))
		}

		fn handle(
			&mut self,
			_api: &mut HostApi,
			_handler: HandlerId,
			_event: &Event,
		) -> Result<(), Error> {
			Ok(())
		}

		fn call(&mut self, _api: &mut HostApi, _method: &str, _args: &Json) -> Result<Json, Error> {
			Err(Error::new("unreachable"))
		}

		fn stop(&mut self, _api: &mut HostApi) -> Result<(), Error> {
			Ok(())
		}
	}

	#[test]
	fn failed_start_is_recorded() {
		let mut runtime = Runtime::new();
		runtime
			.load(manifest("bad.plugin"), Box::new(FailingGuest), Json::obj())
			.unwrap();
		assert!(runtime.start("bad.plugin").is_err());
		let errors = runtime.errors();
		assert_eq!(errors.len(), 1);
		assert_eq!(errors[0].1, "boot failure");
	}

	#[test]
	fn duplicate_ids_are_rejected() {
		let mut runtime = Runtime::new();
		runtime
			.load(manifest("dup"), Box::new(MockGuest::new()), Json::obj())
			.unwrap();
		assert!(runtime
			.load(manifest("dup"), Box::new(MockGuest::new()), Json::obj())
			.is_err());
	}
}
