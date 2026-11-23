use std::collections::{BTreeMap, BTreeSet};
use valenced_core::json::Json;
use valenced_core::manifest::Manifest;
use valenced_core::version::{Requirement, Version};
use valenced_core::Error;

#[derive(Debug, Clone)]
pub struct VersionEntry {
	pub version: Version,
	pub channel: String,
	pub url: String,
	pub size: u64,
	pub sha256: String,
	pub manifest: Manifest,
}

#[derive(Debug, Clone)]
pub struct PluginEntry {
	pub id: String,
	pub versions: Vec<VersionEntry>,
}

impl PluginEntry {
	pub fn best(&self, requirement: &Requirement, channels: &[String]) -> Option<&VersionEntry> {
		for channel in channels {
			let mut candidates: Vec<&VersionEntry> = self
				.versions
				.iter()
				.filter(|entry| entry.channel == *channel && requirement.matches(&entry.version))
				.collect();
			candidates.sort_by(|a, b| b.version.compare(&a.version));
			if let Some(entry) = candidates.first() {
				return Some(entry);
			}
		}
		None
	}
}

#[derive(Debug, Clone, Default)]
pub struct Index {
	pub repo: String,
	pub plugins: BTreeMap<String, PluginEntry>,
}

impl Index {
	pub fn parse(value: &Json) -> Result<Index, Error> {
		let repo = value
			.get("repo")
			.and_then(|v| v.as_str())
			.unwrap_or("pool")
			.to_string();
		let plugins_value = value
			.get("plugins")
			.and_then(|v| v.as_list())
			.ok_or_else(|| Error::new("index: plugins is required"))?;
		let mut plugins = BTreeMap::new();
		for plugin_value in plugins_value {
			let id = plugin_value
				.get("id")
				.and_then(|v| v.as_str())
				.ok_or_else(|| Error::new("index: plugin needs an id"))?
				.to_string();
			let versions_value = plugin_value
				.get("versions")
				.and_then(|v| v.as_list())
				.ok_or_else(|| Error::new(format!("index: {id} needs versions")))?;
			let mut versions = Vec::new();
			for entry_value in versions_value {
				let version = Version::parse(
					entry_value
						.get("version")
						.and_then(|v| v.as_str())
						.ok_or_else(|| Error::new(format!("index: {id} entry needs a version")))?,
				)?;
				let manifest = entry_value
					.get("manifest")
					.ok_or_else(|| Error::new(format!("index: {id} entry needs a manifest")))?;
				let manifest = Manifest::parse(manifest)?;
				if manifest.id != id {
					return Err(Error::new(format!(
						"index: manifest id {} does not match {id}",
						manifest.id
					)));
				}
				if manifest.version != version {
					return Err(Error::new(format!(
						"index: manifest version {version} does not match the entry for {id}"
					)));
				}
				versions.push(VersionEntry {
					version,
					channel: entry_value
						.get("channel")
						.and_then(|v| v.as_str())
						.unwrap_or("stable")
						.to_string(),
					url: entry_value
						.get("url")
						.and_then(|v| v.as_str())
						.unwrap_or("")
						.to_string(),
					size: entry_value
						.get("size")
						.and_then(|v| v.as_num())
						.unwrap_or(0.0) as u64,
					sha256: entry_value
						.get("sha256")
						.and_then(|v| v.as_str())
						.unwrap_or("")
						.to_string(),
					manifest,
				});
			}
			if versions.is_empty() {
				return Err(Error::new(format!("index: {id} has no versions")));
			}
			plugins.insert(
				id.clone(),
				PluginEntry {
					id,
					versions,
				},
			);
		}
		Ok(Index { repo, plugins })
	}

	pub fn from_str(text: &str) -> Result<Index, Error> {
		Index::parse(&valenced_core::json::parse(text)?)
	}
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Step {
	pub id: String,
	pub version: Version,
	pub url: String,
	pub sha256: String,
	pub size: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Plan {
	pub steps: Vec<Step>,
}

pub fn resolve(
	index: &Index,
	wants: &[(String, Requirement)],
	channels: &[String],
) -> Result<Plan, Error> {
	let mut picked: BTreeMap<String, &VersionEntry> = BTreeMap::new();
	let mut visiting: BTreeSet<String> = BTreeSet::new();
	for (id, requirement) in wants {
		resolve_one(index, id, requirement, channels, &mut picked, &mut visiting)?;
	}
	let mut ordered: Vec<&VersionEntry> = Vec::new();
	let mut done: BTreeSet<String> = BTreeSet::new();
	for (id, _) in wants {
		order_one(id, &picked, &mut done, &mut ordered)?;
	}
	Ok(Plan {
		steps: ordered
			.into_iter()
			.map(|entry| Step {
				id: entry.manifest.id.clone(),
				version: entry.version.clone(),
				url: entry.url.clone(),
				sha256: entry.sha256.clone(),
				size: entry.size,
			})
			.collect(),
	})
}

fn resolve_one<'a>(
	index: &'a Index,
	id: &str,
	requirement: &Requirement,
	channels: &[String],
	picked: &mut BTreeMap<String, &'a VersionEntry>,
	visiting: &mut BTreeSet<String>,
) -> Result<(), Error> {
	if let Some(existing) = picked.get(id) {
		if requirement.matches(&existing.version) {
			return Ok(());
		}
		return Err(Error::new(format!(
			"pool: {id} {} was picked and does not satisfy {requirement}",
			existing.version
		)));
	}
	if !visiting.insert(id.to_string()) {
		return Err(Error::new(format!("pool: dependency cycle at {id}")));
	}
	let entry = index
		.plugins
		.get(id)
		.and_then(|plugin| plugin.best(requirement, channels))
		.ok_or_else(|| Error::new(format!("pool: no version of {id} satisfies {requirement}")))?;
	for dep in &entry.manifest.dependencies {
		if dep.optional {
			continue;
		}
		resolve_one(index, &dep.id, &dep.version, channels, picked, visiting)?;
	}
	picked.insert(id.to_string(), entry);
	visiting.remove(id);
	Ok(())
}

fn order_one<'a>(
	id: &str,
	picked: &BTreeMap<String, &'a VersionEntry>,
	done: &mut BTreeSet<String>,
	ordered: &mut Vec<&'a VersionEntry>,
) -> Result<(), Error> {
	if done.contains(id) {
		return Ok(());
	}
	done.insert(id.to_string());
	let entry = *picked
		.get(id)
		.ok_or_else(|| Error::new(format!("pool: {id} was not resolved")))?;
	for dep in &entry.manifest.dependencies {
		if dep.optional || !picked.contains_key(&dep.id) {
			continue;
		}
		order_one(&dep.id, picked, done, ordered)?;
	}
	ordered.push(entry);
	Ok(())
}

#[cfg(test)]
mod tests {
	use super::*;

	const INDEX: &str = r#"{
		"repo": "sid pool",
		"plugins": [
			{
				"id": "valenced.api",
				"versions": [
					{
						"version": "1.2.0",
						"channel": "stable",
						"url": "pool/valenced.api@1.2.0.zip",
						"size": 10,
						"sha256": "aa",
						"manifest": {
							"format": 1,
							"id": "valenced.api",
							"version": "1.2.0",
							"dist": { "script": "index.js" }
						}
					},
					{
						"version": "1.0.0",
						"channel": "stable",
						"url": "pool/valenced.api@1.0.0.zip",
						"size": 9,
						"sha256": "bb",
						"manifest": {
							"format": 1,
							"id": "valenced.api",
							"version": "1.0.0",
							"dist": { "script": "index.js" }
						}
					}
				]
			},
			{
				"id": "com.shin.devlab",
				"versions": [
					{
						"version": "2.0.0",
						"channel": "stable",
						"url": "pool/com.shin.devlab@2.0.0.zip",
						"size": 20,
						"sha256": "cc",
						"manifest": {
							"format": 1,
							"id": "com.shin.devlab",
							"version": "2.0.0",
							"dependencies": { "valenced.api": { "version": ">=1 <2" } },
							"dist": { "script": "index.js" }
						}
					}
				]
			},
			{
				"id": "preview.tool",
				"versions": [
					{
						"version": "3.0.0-rc1",
						"channel": "beta",
						"url": "pool/preview.tool@3.0.0-rc1.zip",
						"size": 5,
						"sha256": "dd",
						"manifest": {
							"format": 1,
							"id": "preview.tool",
							"version": "3.0.0-rc1",
							"dist": { "script": "index.js" }
						}
					}
				]
			}
		]
	}"#;

	fn req(text: &str) -> Requirement {
		Requirement::parse(text).unwrap()
	}

	#[test]
	fn resolves_dependencies_in_order() {
		let index = Index::from_str(INDEX).unwrap();
		let plan = resolve(
			&index,
			&[("com.shin.devlab".to_string(), req("*"))],
			&["stable".to_string()],
		)
		.unwrap();
		assert_eq!(plan.steps.len(), 2);
		assert_eq!(plan.steps[0].id, "valenced.api");
		assert_eq!(plan.steps[0].version, Version::parse("1.2.0").unwrap());
		assert_eq!(plan.steps[1].id, "com.shin.devlab");
	}

	#[test]
	fn channels_gate_versions() {
		let index = Index::from_str(INDEX).unwrap();
		let stable_only = resolve(
			&index,
			&[("preview.tool".to_string(), req("*"))],
			&["stable".to_string()],
		);
		assert!(stable_only.is_err());
		let with_beta = resolve(
			&index,
			&[("preview.tool".to_string(), req("*"))],
			&["beta".to_string(), "stable".to_string()],
		)
		.unwrap();
		assert_eq!(with_beta.steps[0].id, "preview.tool");
	}

	#[test]
	fn respects_version_ranges() {
		let index = Index::from_str(INDEX).unwrap();
		let plan = resolve(
			&index,
			&[
				("valenced.api".to_string(), req(">=1 <1.2")),
				("com.shin.devlab".to_string(), req("*")),
			],
			&["stable".to_string()],
		)
		.unwrap();
		let api = plan.steps.iter().find(|s| s.id == "valenced.api").unwrap();
		assert_eq!(api.version, Version::parse("1.0.0").unwrap());
	}

	#[test]
	fn missing_plugins_fail() {
		let index = Index::from_str(INDEX).unwrap();
		assert!(resolve(
			&index,
			&[("nope".to_string(), req("*"))],
			&["stable".to_string()]
		)
		.is_err());
	}
}
