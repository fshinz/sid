use std::collections::BTreeMap;
use valenced_core::json::Json;
use valenced_core::Error;

use crate::elf;
use crate::pattern::Pattern;

#[derive(Debug, Clone)]
pub enum Op {
	Replace {
		target: String,
		pattern: Pattern,
		with: Pattern,
		expect: usize,
	},
	RenameNeeded {
		target: String,
		from: String,
		to: String,
	},
	Assert {
		target: String,
		pattern: Pattern,
		expect: usize,
	},
}

#[derive(Debug, Clone)]
pub struct Script {
	pub name: String,
	pub ops: Vec<Op>,
}

#[derive(Debug, Default)]
pub struct Report {
	pub steps: Vec<String>,
	pub changed: Vec<String>,
}

impl Script {
	pub fn parse(value: &Json) -> Result<Script, Error> {
		let name = value
			.get("name")
			.and_then(|v| v.as_str())
			.unwrap_or("script")
			.to_string();
		let ops_value = value
			.get("ops")
			.and_then(|v| v.as_list())
			.ok_or_else(|| Error::new("script: ops is required"))?;
		let mut ops = Vec::new();
		for (index, op_value) in ops_value.iter().enumerate() {
			let kind = op_value
				.get("kind")
				.and_then(|v| v.as_str())
				.ok_or_else(|| Error::new(format!("script: op {index} needs a kind")))?;
			let target = op_value
				.get("target")
				.and_then(|v| v.as_str())
				.ok_or_else(|| Error::new(format!("script: op {index} needs a target")))?
				.to_string();
			match kind {
				"replace" => {
					let pattern = Pattern::parse(
						op_value
							.get("pattern")
							.and_then(|v| v.as_str())
							.ok_or_else(|| Error::new(format!("script: op {index} needs a pattern")))?,
					)?;
					let with = Pattern::parse(
						op_value
							.get("with")
							.and_then(|v| v.as_str())
							.ok_or_else(|| Error::new(format!("script: op {index} needs with")))?,
					)?;
					if pattern.len() != with.len() {
						return Err(Error::new(format!(
							"script: op {index} with must match the pattern length"
						)));
					}
					ops.push(Op::Replace {
						target,
						pattern,
						with,
						expect: read_expect(op_value, index)?,
					});
				}
				"rename_needed" => {
					let from = op_value
						.get("from")
						.and_then(|v| v.as_str())
						.ok_or_else(|| Error::new(format!("script: op {index} needs from")))?;
					let to = op_value
						.get("to")
						.and_then(|v| v.as_str())
						.ok_or_else(|| Error::new(format!("script: op {index} needs to")))?;
					ops.push(Op::RenameNeeded {
						target,
						from: from.to_string(),
						to: to.to_string(),
					});
				}
				"assert" => {
					let pattern = Pattern::parse(
						op_value
							.get("pattern")
							.and_then(|v| v.as_str())
							.ok_or_else(|| Error::new(format!("script: op {index} needs a pattern")))?,
					)?;
					ops.push(Op::Assert {
						target,
						pattern,
						expect: read_expect(op_value, index)?,
					});
				}
				other => {
					return Err(Error::new(format!("script: unknown op kind {other}")));
				}
			}
		}
		Ok(Script { name, ops })
	}

	pub fn from_str(text: &str) -> Result<Script, Error> {
		Script::parse(&valenced_core::json::parse(text)?)
	}

	pub fn apply(&self, files: &mut BTreeMap<String, Vec<u8>>) -> Result<Report, Error> {
		let mut report = Report::default();
		for (index, op) in self.ops.iter().enumerate() {
			match op {
				Op::Replace {
					target,
					pattern,
					with,
					expect,
				} => {
					let data = files.get_mut(target).ok_or_else(|| {
						Error::new(format!("script: op {index} target {target} is missing"))
					})?;
					let hits = pattern.find_all(data);
					if hits.len() != *expect {
						return Err(Error::new(format!(
							"script: op {index} matched {} times in {target}, expected {expect}",
							hits.len()
						)));
					}
					for at in hits.iter().rev() {
						let rendered = with.render(data, *at);
						data[*at..*at + with.len()].copy_from_slice(&rendered);
					}
					report
						.steps
						.push(format!("op {index}: replaced {} match(es) in {target}", expect));
					if !report.changed.contains(target) {
						report.changed.push(target.clone());
					}
				}
				Op::RenameNeeded { target, from, to } => {
					let data = files.get_mut(target).ok_or_else(|| {
						Error::new(format!("script: op {index} target {target} is missing"))
					})?;
					let count = elf::rename_needed(data, from, to)?;
					report
						.steps
						.push(format!("op {index}: renamed {from} to {to} ({count}) in {target}"));
					if !report.changed.contains(target) {
						report.changed.push(target.clone());
					}
				}
				Op::Assert {
					target,
					pattern,
					expect,
				} => {
					let data = files.get(target).ok_or_else(|| {
						Error::new(format!("script: op {index} target {target} is missing"))
					})?;
					let hits = pattern.find_all(data);
					if hits.len() != *expect {
						return Err(Error::new(format!(
							"script: op {index} matched {} times in {target}, expected {expect}",
							hits.len()
						)));
					}
					report.steps.push(format!("op {index}: asserted {target}"));
				}
			}
		}
		Ok(report)
	}
}

fn read_expect(value: &Json, index: usize) -> Result<usize, Error> {
	value
		.get("expect")
		.and_then(|v| v.as_num())
		.ok_or_else(|| Error::new(format!("script: op {index} needs expect")))?
		.try_into()
		.map_err(|_| Error::new(format!("script: op {index} has a bad expect")))
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn applies_replace_and_assert() {
		let mut files = BTreeMap::new();
		files.insert("code.bin".to_string(), vec![0x90, 0x01, 0x02, 0x90, 0x03]);
		let script = Script::from_str(
			r#"{
				"name": "test",
				"ops": [
					{ "kind": "replace", "target": "code.bin", "pattern": "90 ??", "with": "cc 00", "expect": 2 },
					{ "kind": "assert", "target": "code.bin", "pattern": "cc", "expect": 2 }
				]
			}"#,
		)
		.unwrap();
		let report = script.apply(&mut files).unwrap();
		assert_eq!(report.steps.len(), 2);
		assert_eq!(report.changed, vec!["code.bin".to_string()]);
		assert_eq!(files["code.bin"], vec![0xCC, 0x00, 0x02, 0xCC, 0x00]);
	}

	#[test]
	fn keeps_original_bytes_on_wildcard() {
		let mut files = BTreeMap::new();
		files.insert("x.bin".to_string(), vec![0xAA, 0xBB]);
		let script = Script::from_str(
			r#"{"name": "t", "ops": [
				{ "kind": "replace", "target": "x.bin", "pattern": "aa bb", "with": "?? cc", "expect": 1 }
			]}"#,
		)
		.unwrap();
		script.apply(&mut files).unwrap();
		assert_eq!(files["x.bin"], vec![0xAA, 0xCC]);
	}

	#[test]
	fn fails_on_unexpected_counts_and_missing_targets() {
		let mut files = BTreeMap::new();
		files.insert("x.bin".to_string(), vec![0x00]);
		let mismatch = Script::from_str(
			r#"{"name": "t", "ops": [
				{ "kind": "replace", "target": "x.bin", "pattern": "00", "with": "01", "expect": 2 }
			]}"#,
		)
		.unwrap();
		assert!(mismatch.apply(&mut files).is_err());
		let missing = Script::from_str(
			r#"{"name": "t", "ops": [
				{ "kind": "assert", "target": "gone.bin", "pattern": "00", "expect": 1 }
			]}"#,
		)
		.unwrap();
		assert!(missing.apply(&mut files).is_err());
	}

	#[test]
	fn rejects_malformed_scripts() {
		assert!(Script::from_str("{}").is_err());
		assert!(Script::from_str(r#"{"name": "t", "ops": [{"kind": "explode"}]}"#).is_err());
		assert!(Script::from_str(
			r#"{"name": "t", "ops": [
				{ "kind": "replace", "target": "x", "pattern": "00 01", "with": "00", "expect": 1 }
			]}"#
		)
		.is_err());
	}
}
