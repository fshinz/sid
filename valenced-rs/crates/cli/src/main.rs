use std::collections::BTreeMap;
use valenced_core::sha256::sha256_hex;
use valenced_core::version::Requirement;
use valenced_core::Error;
use valenced_patch::Script;
use valenced_pool::resolve;

const USAGE: &str = "usage: valenced <plan|patch|verify|doctor> ...";

fn main() {
	let args: Vec<String> = std::env::args().skip(1).collect();
	match run(&args) {
		Ok(output) => {
			if !output.is_empty() {
				println!("{output}");
			}
		}
		Err(error) => {
			eprintln!("valenced: {error}");
			std::process::exit(1);
		}
	}
}

pub fn run(args: &[String]) -> Result<String, Error> {
	let (command, rest) = args
		.split_first()
		.ok_or_else(|| Error::new(USAGE))?;
	match command.as_str() {
		"plan" => plan_cmd(rest),
		"patch" => patch_cmd(rest),
		"verify" => verify_cmd(rest),
		"doctor" => Ok(format!(
			"valenced {} on {}",
			env!("CARGO_PKG_VERSION"),
			std::env::consts::OS
		)),
		_ => Err(Error::new(USAGE)),
	}
}

fn plan_cmd(args: &[String]) -> Result<String, Error> {
	let mut index_path: Option<String> = None;
	let mut channels: Vec<String> = vec!["stable".to_string()];
	let mut wants: Vec<(String, Requirement)> = Vec::new();
	let mut at = 0usize;
	while at < args.len() {
		match args[at].as_str() {
			"--index" => {
				at += 1;
				index_path = Some(
					args.get(at)
						.ok_or_else(|| Error::new("plan: --index needs a path"))?
						.clone(),
				);
			}
			"--channel" => {
				at += 1;
				let channel = args
					.get(at)
					.ok_or_else(|| Error::new("plan: --channel needs a name"))?;
				if channels == vec!["stable".to_string()] {
					channels.clear();
				}
				channels.push(channel.clone());
			}
			other => {
				let (id, requirement) = match other.split_once('@') {
					Some((id, req)) => (id.to_string(), Requirement::parse(req)?),
					None => (other.to_string(), Requirement::any()),
				};
				wants.push((id, requirement));
			}
		}
		at += 1;
	}
	let index_path = index_path.ok_or_else(|| Error::new("plan: --index is required"))?;
	if wants.is_empty() {
		return Err(Error::new("plan: name at least one plugin"));
	}
	let text = std::fs::read_to_string(&index_path)
		.map_err(|error| Error::new(format!("plan: cannot read {index_path}: {error}")))?;
	let index = valenced_pool::Index::from_str(&text)?;
	let plan = resolve(&index, &wants, &channels)?;
	let mut out = String::new();
	for step in &plan.steps {
		out.push_str(&format!(
			"{} {} {} bytes {} {}\n",
			step.id, step.version, step.size, step.sha256, step.url
		));
	}
	Ok(out.trim_end().to_string())
}

fn patch_cmd(args: &[String]) -> Result<String, Error> {
	let mut script_path: Option<String> = None;
	let mut dry_run = false;
	let mut files: Vec<String> = Vec::new();
	let mut at = 0usize;
	while at < args.len() {
		match args[at].as_str() {
			"--script" => {
				at += 1;
				script_path = Some(
					args.get(at)
						.ok_or_else(|| Error::new("patch: --script needs a path"))?
						.clone(),
				);
			}
			"--dry-run" => dry_run = true,
			other => files.push(other.to_string()),
		}
		at += 1;
	}
	let script_path = script_path.ok_or_else(|| Error::new("patch: --script is required"))?;
	if files.is_empty() {
		return Err(Error::new("patch: name at least one file"));
	}
	let script_text = std::fs::read_to_string(&script_path)
		.map_err(|error| Error::new(format!("patch: cannot read {script_path}: {error}")))?;
	let script = Script::from_str(&script_text)?;
	let mut payload: BTreeMap<String, Vec<u8>> = BTreeMap::new();
	for file in &files {
		let bytes = std::fs::read(file)
			.map_err(|error| Error::new(format!("patch: cannot read {file}: {error}")))?;
		payload.insert(file.clone(), bytes);
	}
	let report = script.apply(&mut payload)?;
	if !dry_run {
		for target in &report.changed {
			std::fs::write(target, &payload[target])
				.map_err(|error| Error::new(format!("patch: cannot write {target}: {error}")))?;
		}
	}
	let mut out = format!("script {}\n", script.name);
	for step in &report.steps {
		out.push_str(&format!("{step}\n"));
	}
	if dry_run {
		out.push_str("dry run, nothing written\n");
	}
	Ok(out.trim_end().to_string())
}

fn verify_cmd(args: &[String]) -> Result<String, Error> {
	let mut expected: Option<String> = None;
	let mut file: Option<String> = None;
	let mut at = 0usize;
	while at < args.len() {
		match args[at].as_str() {
			"--sha256" => {
				at += 1;
				expected = Some(
					args.get(at)
						.ok_or_else(|| Error::new("verify: --sha256 needs a digest"))?
						.to_lowercase(),
				);
			}
			other => file = Some(other.to_string()),
		}
		at += 1;
	}
	let expected = expected.ok_or_else(|| Error::new("verify: --sha256 is required"))?;
	let file = file.ok_or_else(|| Error::new("verify: name a file"))?;
	let bytes = std::fs::read(&file)
		.map_err(|error| Error::new(format!("verify: cannot read {file}: {error}")))?;
	let actual = sha256_hex(&bytes);
	if actual != expected {
		return Err(Error::new(format!(
			"verify: {file} is {actual}, expected {expected}"
		)));
	}
	Ok(format!("ok {file}"))
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::path::PathBuf;

	fn strings(items: &[&str]) -> Vec<String> {
		items.iter().map(|s| s.to_string()).collect()
	}

	fn scratch() -> PathBuf {
		let dir = std::env::temp_dir().join(format!(
			"valenced-cli-{}-{:?}",
			std::process::id(),
			std::thread::current().id()
		));
		std::fs::create_dir_all(&dir).unwrap();
		dir
	}

	#[test]
	fn doctor_reports_version() {
		let output = run(&strings(&["doctor"])).unwrap();
		assert!(output.contains("valenced 0.1.0"));
	}

	#[test]
	fn plan_resolves_from_index_file() {
		let dir = scratch();
		let index = dir.join("index.json");
		std::fs::write(
			&index,
			r#"{
				"plugins": [
					{
						"id": "demo",
						"versions": [
							{
								"version": "1.0.0",
								"channel": "stable",
								"url": "pool/demo@1.0.0.zip",
								"size": 12,
								"sha256": "ab",
								"manifest": {
									"format": 1,
									"id": "demo",
									"version": "1.0.0",
									"dist": { "script": "index.js" }
								}
							}
						]
					}
				]
			}"#,
		)
		.unwrap();
		let output = run(&strings(&[
			"plan",
			"--index",
			index.to_str().unwrap(),
			"demo",
		]))
		.unwrap();
		assert!(output.contains("demo 1.0.0 12 ab pool/demo@1.0.0.zip"));
		std::fs::remove_dir_all(&dir).ok();
	}

	#[test]
	fn patch_applies_and_dry_runs() {
		let dir = scratch();
		let script = dir.join("unlock.json");
		let target = dir.join("code.bin");
		std::fs::write(
			&script,
			r#"{"name": "unlock", "ops": [
				{ "kind": "replace", "target": "TARGET", "pattern": "90", "with": "c3", "expect": 1 }
			]}"#
			.replace("TARGET", target.to_str().unwrap()),
		)
		.unwrap();
		std::fs::write(&target, [0x90u8, 0x01]).unwrap();

		let dry = run(&strings(&[
			"patch",
			"--script",
			script.to_str().unwrap(),
			"--dry-run",
			target.to_str().unwrap(),
		]))
		.unwrap();
		assert!(dry.contains("dry run"));
		assert_eq!(std::fs::read(&target).unwrap(), vec![0x90, 0x01]);

		run(&strings(&[
			"patch",
			"--script",
			script.to_str().unwrap(),
			target.to_str().unwrap(),
		]))
		.unwrap();
		assert_eq!(std::fs::read(&target).unwrap(), vec![0xC3, 0x01]);
		std::fs::remove_dir_all(&dir).ok();
	}

	#[test]
	fn verify_checks_digests() {
		let dir = scratch();
		let file = dir.join("blob.bin");
		std::fs::write(&file, b"abc").unwrap();
		let ok = run(&strings(&[
			"verify",
			"--sha256",
			"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
			file.to_str().unwrap(),
		]))
		.unwrap();
		assert!(ok.starts_with("ok"));
		assert!(run(&strings(&["verify", "--sha256", "00", file.to_str().unwrap()])).is_err());
		std::fs::remove_dir_all(&dir).ok();
	}

	#[test]
	fn rejects_bad_arguments() {
		assert!(run(&strings(&[])).is_err());
		assert!(run(&strings(&["explode"])).is_err());
		assert!(run(&strings(&["plan"])).is_err());
		assert!(run(&strings(&["patch", "--script", "x"])).is_err());
	}
}
