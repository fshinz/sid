use crate::json::Json;

pub fn deep_merge(dst: &mut Json, src: &Json) {
	match (dst, src) {
		(Json::Obj(dst_entries), Json::Obj(src_entries)) => {
			for (key, value) in src_entries {
				match dst_entries.iter_mut().find(|(k, _)| k == key) {
					Some((_, slot)) => deep_merge(slot, value),
					None => dst_entries.push((key.clone(), value.clone())),
				}
			}
		}
		(dst, src) => *dst = src.clone(),
	}
}

#[derive(Debug, Clone)]
pub struct Storage {
	default: Json,
	cache: Json,
	loaded: bool,
}

impl Storage {
	pub fn new(default: Json) -> Storage {
		Storage {
			cache: default.clone(),
			default,
			loaded: false,
		}
	}

	pub fn load(&mut self, doc: Json) {
		let mut merged = self.default.clone();
		deep_merge(&mut merged, &doc);
		self.cache = merged;
		self.loaded = true;
	}

	pub fn get(&self) -> &Json {
		&self.cache
	}

	pub fn loaded(&self) -> bool {
		self.loaded
	}

	pub fn set(&mut self, value: &Json, replace: bool) {
		if replace {
			let mut merged = self.default.clone();
			deep_merge(&mut merged, value);
			self.cache = merged;
		} else {
			deep_merge(&mut self.cache, value);
		}
		self.loaded = true;
	}

	pub fn default(&self) -> &Json {
		&self.default
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::json;

	#[test]
	fn defaults_apply_until_overridden() {
		let default = json::parse(r#"{"a": 1, "nested": {"x": true}}"#).unwrap();
		let mut storage = Storage::new(default);
		assert_eq!(storage.get().get("a").unwrap().as_num(), Some(1.0));
		assert!(!storage.loaded());
		storage.load(json::parse(r#"{"a": 2}"#).unwrap());
		assert!(storage.loaded());
		assert_eq!(storage.get().get("a").unwrap().as_num(), Some(2.0));
		assert_eq!(
			storage.get().get("nested").unwrap().get("x").unwrap().as_bool(),
			Some(true)
		);
	}

	#[test]
	fn merge_keeps_siblings() {
		let mut storage = Storage::new(json::parse(r#"{"a": 1, "b": 2}"#).unwrap());
		storage.set(&json::parse(r#"{"b": 3}"#).unwrap(), false);
		assert_eq!(storage.get().get("a").unwrap().as_num(), Some(1.0));
		assert_eq!(storage.get().get("b").unwrap().as_num(), Some(3.0));
	}

	#[test]
	fn replace_resets_to_defaults() {
		let mut storage = Storage::new(json::parse(r#"{"a": 1, "b": 2}"#).unwrap());
		storage.set(&json::parse(r#"{"x": 5}"#).unwrap(), false);
		assert_eq!(storage.get().get("x").unwrap().as_num(), Some(5.0));
		storage.set(&json::parse(r#"{"c": 3}"#).unwrap(), true);
		assert!(storage.get().get("x").is_none());
		assert_eq!(storage.get().get("a").unwrap().as_num(), Some(1.0));
		assert_eq!(storage.get().get("b").unwrap().as_num(), Some(2.0));
		assert_eq!(storage.get().get("c").unwrap().as_num(), Some(3.0));
	}

	#[test]
	fn deep_merge_replaces_non_objects() {
		let mut dst = json::parse(r#"{"list": [1], "n": {"a": 1}}"#).unwrap();
		deep_merge(&mut dst, &json::parse(r#"{"list": [2, 3], "n": 5}"#).unwrap());
		assert_eq!(dst.get("n").unwrap().as_num(), Some(5.0));
		assert_eq!(dst.get("list").unwrap().as_list().unwrap().len(), 2);
	}
}
