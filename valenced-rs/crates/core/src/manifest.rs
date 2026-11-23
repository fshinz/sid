use crate::json::Json;
use crate::version::{Requirement, Version};
use crate::Error;

pub const SUPPORTED_FORMAT: u32 = 1;

#[derive(Debug, Clone, PartialEq)]
pub struct Dependency {
	pub id: String,
	pub version: Requirement,
	pub optional: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AndroidDist {
	pub path: String,
	pub class: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PhoenixDist {
	pub guest: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Dist {
	pub script: String,
	pub android: Option<AndroidDist>,
	pub phoenix: Option<PhoenixDist>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Manifest {
	pub format: u32,
	pub id: String,
	pub name: String,
	pub description: String,
	pub author: String,
	pub version: Version,
	pub icon: String,
	pub dependencies: Vec<Dependency>,
	pub dist: Dist,
}

impl Manifest {
	pub fn parse(value: &Json) -> Result<Manifest, Error> {
		let format = value
			.get("format")
			.and_then(|v| v.as_num())
			.ok_or_else(|| Error::new("manifest: format is required"))? as u32;
		if format != SUPPORTED_FORMAT {
			return Err(Error::new(format!(
				"manifest: unsupported format {format}"
			)));
		}
		let id = required_str(value, "id")?;
		if id.is_empty()
			|| id.len() > 128
			|| !id
				.bytes()
				.all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'_'))
		{
			return Err(Error::new(format!("manifest: bad id {id}")));
		}
		let version = Version::parse(required_str(value, "version")?)?;
		let mut dependencies = Vec::new();
		if let Some(Json::Obj(entries)) = value.get("dependencies") {
			for (dep_id, spec) in entries {
				let (version_text, optional) = match spec {
					Json::Str(text) => (text.as_str(), false),
					Json::Obj(fields) => (
						fields
							.iter()
							.find(|(k, _)| k == "version")
							.and_then(|(_, v)| v.as_str())
							.unwrap_or("*"),
						fields
							.iter()
							.find(|(k, _)| k == "optional")
							.and_then(|(_, v)| v.as_bool())
							.unwrap_or(false),
					),
					_ => {
						return Err(Error::new(format!(
							"manifest: bad dependency spec for {dep_id}"
						)))
					}
				};
				dependencies.push(Dependency {
					id: dep_id.clone(),
					version: Requirement::parse(version_text)?,
					optional,
				});
			}
		}
		let dist_value = value
			.get("dist")
			.ok_or_else(|| Error::new("manifest: dist is required"))?;
		let script = required_str(dist_value, "script")?.to_string();
		let android = dist_value.get("android").map(|android| -> Result<AndroidDist, Error> {
			Ok(AndroidDist {
				path: required_str(android, "path")?.to_string(),
				class: required_str(android, "class")?.to_string(),
			})
		}).transpose()?;
		let phoenix = dist_value.get("phoenix").map(|phoenix| -> Result<PhoenixDist, Error> {
			Ok(PhoenixDist {
				guest: required_str(phoenix, "guest")?.to_string(),
			})
		}).transpose()?;
		Ok(Manifest {
			format,
			id: id.to_string(),
			name: optional_str(value, "name").unwrap_or("").to_string(),
			description: optional_str(value, "description").unwrap_or("").to_string(),
			author: optional_str(value, "author").unwrap_or("").to_string(),
			version,
			icon: optional_str(value, "icon").unwrap_or("").to_string(),
			dependencies,
			dist: Dist {
				script,
				android,
				phoenix,
			},
		})
	}

	pub fn from_str(text: &str) -> Result<Manifest, Error> {
		Manifest::parse(&crate::json::parse(text)?)
	}

	pub fn dependency(&self, id: &str) -> Option<&Dependency> {
		self.dependencies.iter().find(|dep| dep.id == id)
	}
}

fn required_str<'a>(value: &'a Json, key: &str) -> Result<&'a str, Error> {
	value
		.get(key)
		.and_then(|v| v.as_str())
		.ok_or_else(|| Error::new(format!("manifest: {key} is required")))
}

fn optional_str<'a>(value: &'a Json, key: &str) -> Option<&'a str> {
	value.get(key).and_then(|v| v.as_str())
}

#[cfg(test)]
mod tests {
	use super::*;

	const SAMPLE: &str = r#"{
		"format": 1,
		"id": "com.liquidglass.fx",
		"name": "Liquid Glass",
		"description": "real liquid glass",
		"author": "shin",
		"version": "1.2.0-rc1",
		"icon": "CloudIcon",
		"dependencies": {
			"valenced.api": { "version": ">=1 <2" },
			"discord": { "version": "*", "optional": true }
		},
		"dist": {
			"script": "index.js",
			"phoenix": { "guest": "guest.wasm" }
		}
	}"#;

	#[test]
	fn parses_real_shaped_manifest() {
		let manifest = Manifest::from_str(SAMPLE).unwrap();
		assert_eq!(manifest.id, "com.liquidglass.fx");
		assert_eq!(manifest.version, Version::parse("1.2.0-rc1").unwrap());
		assert_eq!(manifest.dependencies.len(), 2);
		let api = manifest.dependency("valenced.api").unwrap();
		assert!(api.version.matches(&Version::parse("1.4.0").unwrap()));
		assert!(!api.version.matches(&Version::parse("2.0.0").unwrap()));
		assert!(manifest.dependency("discord").unwrap().optional);
		assert_eq!(manifest.dist.script, "index.js");
		assert!(manifest.dist.phoenix.is_some());
		assert!(manifest.dist.android.is_none());
	}

	#[test]
	fn string_dependency_is_exact() {
		let text = r#"{
			"format": 1,
			"id": "a.b",
			"version": "1",
			"dependencies": { "other": "1.0.0" },
			"dist": { "script": "index.js" }
		}"#;
		let manifest = Manifest::from_str(text).unwrap();
		let dep = manifest.dependency("other").unwrap();
		assert!(dep.version.matches(&Version::parse("1.0.0").unwrap()));
		assert!(!dep.version.matches(&Version::parse("1.0.1").unwrap()));
	}

	#[test]
	fn rejects_bad_manifests() {
		assert!(Manifest::from_str("{}").is_err());
		let bad_id = SAMPLE.replace("com.liquidglass.fx", "has space");
		assert!(Manifest::from_str(&bad_id).is_err());
		let bad_format = SAMPLE.replace("\"format\": 1", "\"format\": 9");
		assert!(Manifest::from_str(&bad_format).is_err());
		let bad_version = SAMPLE.replace("1.2.0-rc1", "not.a.version");
		assert!(Manifest::from_str(&bad_version).is_err());
		let missing_dist = SAMPLE.replace("\"dist\"", "\"distx\"");
		assert!(Manifest::from_str(&missing_dist).is_err());
	}
}
