use crate::json::Json;
use crate::Error;
use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Phase {
	Registered,
	Started,
	Stopped,
}

#[derive(Debug, Clone)]
pub struct Event {
	pub name: String,
	pub payload: Json,
}

impl Event {
	pub fn new(name: impl Into<String>, payload: Json) -> Event {
		Event {
			name: name.into(),
			payload,
		}
	}
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Filter {
	pub name: Option<String>,
	pub fields: Vec<(String, String)>,
}

impl Filter {
	pub fn all() -> Filter {
		Filter {
			name: None,
			fields: Vec::new(),
		}
	}

	pub fn named(name: impl Into<String>) -> Filter {
		Filter {
			name: Some(name.into()),
			fields: Vec::new(),
		}
	}

	pub fn with_field(mut self, key: impl Into<String>, value: impl Into<String>) -> Filter {
		self.fields.push((key.into(), value.into()));
		self
	}

	pub fn matches(&self, event: &Event) -> bool {
		if let Some(name) = &self.name {
			if name != &event.name {
				return false;
			}
		}
		self.fields.iter().all(|(key, value)| {
			event
				.payload
				.get(key)
				.and_then(|v| v.as_str())
				.map(|actual| actual == value)
				.unwrap_or(false)
		})
	}
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct HandlerId(pub u64);

#[derive(Debug, Default)]
pub struct Dispatcher {
	by_name: BTreeMap<String, Vec<(HandlerId, Filter)>>,
	wildcard: Vec<(HandlerId, Filter)>,
	next: u64,
}

impl Dispatcher {
	pub fn new() -> Dispatcher {
		Dispatcher::default()
	}

	pub fn on(&mut self, filter: Filter) -> HandlerId {
		self.next += 1;
		let id = HandlerId(self.next);
		match &filter.name {
			Some(name) => self
				.by_name
				.entry(name.clone())
				.or_default()
				.push((id, filter)),
			None => self.wildcard.push((id, filter)),
		}
		id
	}

	pub fn off(&mut self, id: HandlerId) {
		self.by_name.retain(|_, slots| {
			slots.retain(|(slot, _)| *slot != id);
			!slots.is_empty()
		});
		self.wildcard.retain(|(slot, _)| *slot != id);
	}

	pub fn dispatch(&self, event: &Event) -> Vec<HandlerId> {
		let mut out = Vec::new();
		if let Some(slots) = self.by_name.get(&event.name) {
			for (id, filter) in slots {
				if filter.matches(event) {
					out.push(*id);
				}
			}
		}
		for (id, filter) in &self.wildcard {
			if filter.matches(event) {
				out.push(*id);
			}
		}
		out
	}
}

#[derive(Debug, Clone)]
pub struct PluginState {
	pub id: String,
	pub phase: Phase,
	pub error: Option<String>,
}

#[derive(Debug, Default)]
pub struct Registry {
	plugins: Vec<PluginState>,
}

impl Registry {
	pub fn new() -> Registry {
		Registry::default()
	}

	pub fn register(&mut self, id: impl Into<String>) -> Result<(), Error> {
		let id = id.into();
		if self.plugins.iter().any(|p| p.id == id) {
			return Err(Error::new(format!("registry: {id} already registered")));
		}
		self.plugins.push(PluginState {
			id,
			phase: Phase::Registered,
			error: None,
		});
		Ok(())
	}

	pub fn phase(&self, id: &str) -> Result<Phase, Error> {
		self.plugins
			.iter()
			.find(|p| p.id == id)
			.map(|p| p.phase)
			.ok_or_else(|| Error::new(format!("registry: unknown plugin {id}")))
	}

	pub fn set_phase(&mut self, id: &str, phase: Phase) -> Result<(), Error> {
		let plugin = self
			.plugins
			.iter_mut()
			.find(|p| p.id == id)
			.ok_or_else(|| Error::new(format!("registry: unknown plugin {id}")))?;
		match (plugin.phase, phase) {
			(Phase::Registered, Phase::Started)
			| (Phase::Stopped, Phase::Started)
			| (Phase::Started, Phase::Stopped) => {
				plugin.phase = phase;
				plugin.error = None;
				Ok(())
			}
			(from, to) => Err(Error::new(format!(
				"registry: {id} cannot move from {from:?} to {to:?}"
			))),
		}
	}

	pub fn set_error(&mut self, id: &str, message: impl Into<String>) {
		if let Some(plugin) = self.plugins.iter_mut().find(|p| p.id == id) {
			plugin.error = Some(message.into());
		}
	}

	pub fn error(&self, id: &str) -> Option<&str> {
		self.plugins
			.iter()
			.find(|p| p.id == id)
			.and_then(|p| p.error.as_deref())
	}

	pub fn ids(&self) -> Vec<String> {
		self.plugins.iter().map(|p| p.id.clone()).collect()
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn dispatch_routes_by_name_and_fields() {
		let mut dispatcher = Dispatcher::new();
		let message_handler = dispatcher.on(Filter::named("gateway.messageCreate"));
		let http_handler = dispatcher
			.on(Filter::named("http.response").with_field("path", "/api/v9/users/@me"));
		let everything = dispatcher.on(Filter::all());

		let message = Event::new("gateway.messageCreate", Json::obj());
		assert_eq!(dispatcher.dispatch(&message), vec![message_handler, everything]);

		let matching = Event::new(
			"http.response",
			json_with("path", "/api/v9/users/@me"),
		);
		assert_eq!(dispatcher.dispatch(&matching), vec![http_handler, everything]);

		let other = Event::new("http.response", json_with("path", "/api/v9/channels"));
		assert_eq!(dispatcher.dispatch(&other), vec![everything]);
	}

	fn json_with(key: &str, value: &str) -> Json {
		let mut obj = Json::obj();
		obj.set(key, Json::from(value));
		obj
	}

	#[test]
	fn off_removes_handlers() {
		let mut dispatcher = Dispatcher::new();
		let id = dispatcher.on(Filter::named("x"));
		dispatcher.off(id);
		assert!(dispatcher.dispatch(&Event::new("x", Json::obj())).is_empty());
	}

	#[test]
	fn registry_enforces_lifecycle() {
		let mut registry = Registry::new();
		registry.register("a").unwrap();
		assert_eq!(registry.phase("a").unwrap(), Phase::Registered);
		registry.set_phase("a", Phase::Started).unwrap();
		assert!(registry.set_phase("a", Phase::Started).is_err());
		registry.set_phase("a", Phase::Stopped).unwrap();
		registry.set_phase("a", Phase::Started).unwrap();
		assert!(registry.register("a").is_err());
		assert!(registry.phase("missing").is_err());
		registry.set_error("a", "boom");
		assert_eq!(registry.error("a"), Some("boom"));
	}
}
