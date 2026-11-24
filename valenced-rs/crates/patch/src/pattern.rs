use valenced_core::Error;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Pattern {
	pub bytes: Vec<Option<u8>>,
}

impl Pattern {
	pub fn parse(spec: &str) -> Result<Pattern, Error> {
		let mut bytes = Vec::new();
		for token in spec.split_whitespace() {
			if token == "??" {
				bytes.push(None);
				continue;
			}
			if token.len() != 2 {
				return Err(Error::new(format!("pattern: bad token {token}")));
			}
			let value = u8::from_str_radix(token, 16)
				.map_err(|_| Error::new(format!("pattern: bad token {token}")))?;
			bytes.push(Some(value));
		}
		if bytes.is_empty() {
			return Err(Error::new("pattern: empty"));
		}
		Ok(Pattern { bytes })
	}

	pub fn len(&self) -> usize {
		self.bytes.len()
	}

	pub fn matches_at(&self, hay: &[u8], at: usize) -> bool {
		if at + self.bytes.len() > hay.len() {
			return false;
		}
		self.bytes
			.iter()
			.enumerate()
			.all(|(index, byte)| match byte {
				None => true,
				Some(value) => hay[at + index] == *value,
			})
	}

	pub fn find_all(&self, hay: &[u8]) -> Vec<usize> {
		let mut out = Vec::new();
		if self.bytes.len() > hay.len() {
			return out;
		}
		for at in 0..=(hay.len() - self.bytes.len()) {
			if self.matches_at(hay, at) {
				out.push(at);
			}
		}
		out
	}

	pub fn render(&self, hay: &[u8], at: usize) -> Vec<u8> {
		self.bytes
			.iter()
			.enumerate()
			.map(|(index, byte)| match byte {
				None => hay[at + index],
				Some(value) => *value,
			})
			.collect()
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn finds_exact_and_wildcard() {
		let hay: &[u8] = &[0x48, 0x89, 0xE5, 0x48, 0x89, 0xF3, 0x90];
		let exact = Pattern::parse("48 89 e5").unwrap();
		assert_eq!(exact.find_all(hay), vec![0]);
		let wild = Pattern::parse("48 89 ??").unwrap();
		assert_eq!(wild.find_all(hay), vec![0, 3]);
		let missing = Pattern::parse("de ad").unwrap();
		assert!(missing.find_all(hay).is_empty());
	}

	#[test]
	fn renders_wildcards_from_source() {
		let hay: &[u8] = &[0x48, 0x89, 0xE5];
		let pattern = Pattern::parse("90 ?? cc").unwrap();
		assert_eq!(pattern.render(hay, 0), vec![0x90, 0x89, 0xCC]);
	}

	#[test]
	fn rejects_bad_specs() {
		assert!(Pattern::parse("").is_err());
		assert!(Pattern::parse("4").is_err());
		assert!(Pattern::parse("zz").is_err());
	}
}
