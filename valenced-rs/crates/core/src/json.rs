use crate::Error;

#[derive(Debug, Clone, PartialEq)]
pub enum Json {
	Null,
	Bool(bool),
	Num(f64),
	Str(String),
	List(Vec<Json>),
	Obj(Vec<(String, Json)>),
}

impl Json {
	pub fn obj() -> Json {
		Json::Obj(Vec::new())
	}

	pub fn get(&self, key: &str) -> Option<&Json> {
		match self {
			Json::Obj(entries) => entries.iter().find(|(k, _)| k == key).map(|(_, v)| v),
			_ => None,
		}
	}

	pub fn set(&mut self, key: &str, value: Json) {
		if let Json::Obj(entries) = self {
			if let Some(slot) = entries.iter_mut().find(|(k, _)| k == key) {
				slot.1 = value;
			} else {
				entries.push((key.to_string(), value));
			}
		}
	}

	pub fn as_str(&self) -> Option<&str> {
		match self {
			Json::Str(s) => Some(s),
			_ => None,
		}
	}

	pub fn as_bool(&self) -> Option<bool> {
		match self {
			Json::Bool(b) => Some(*b),
			_ => None,
		}
	}

	pub fn as_num(&self) -> Option<f64> {
		match self {
			Json::Num(n) => Some(*n),
			_ => None,
		}
	}

	pub fn as_list(&self) -> Option<&[Json]> {
		match self {
			Json::List(items) => Some(items),
			_ => None,
		}
	}

	pub fn as_obj(&self) -> Option<&[(String, Json)]> {
		match self {
			Json::Obj(entries) => Some(entries),
			_ => None,
		}
	}

	pub fn is_null(&self) -> bool {
		matches!(self, Json::Null)
	}

	pub fn to_string_pretty(&self) -> String {
		let mut out = String::new();
		write_pretty(self, 0, &mut out);
		out
	}
}

impl From<bool> for Json {
	fn from(value: bool) -> Json {
		Json::Bool(value)
	}
}

impl From<f64> for Json {
	fn from(value: f64) -> Json {
		Json::Num(value)
	}
}

impl From<u64> for Json {
	fn from(value: u64) -> Json {
		Json::Num(value as f64)
	}
}

impl From<usize> for Json {
	fn from(value: usize) -> Json {
		Json::Num(value as f64)
	}
}

impl From<&str> for Json {
	fn from(value: &str) -> Json {
		Json::Str(value.to_string())
	}
}

impl From<String> for Json {
	fn from(value: String) -> Json {
		Json::Str(value)
	}
}

pub fn parse(text: &str) -> Result<Json, Error> {
	let bytes = text.as_bytes();
	let mut at = 0usize;
	skip_space(bytes, &mut at);
	let value = parse_value(bytes, &mut at, 0)?;
	skip_space(bytes, &mut at);
	if at != bytes.len() {
		return Err(err(bytes, at, "trailing content"));
	}
	Ok(value)
}

const MAX_DEPTH: usize = 128;

fn err(bytes: &[u8], at: usize, what: &str) -> Error {
	let mut line = 1usize;
	let mut col = 1usize;
	for byte in &bytes[..at.min(bytes.len())] {
		if *byte == b'\n' {
			line += 1;
			col = 1;
		} else {
			col += 1;
		}
	}
	Error::new(format!("json: {what} at line {line} column {col}"))
}

fn skip_space(bytes: &[u8], at: &mut usize) {
	while *at < bytes.len() && matches!(bytes[*at], b' ' | b'\t' | b'\n' | b'\r') {
		*at += 1;
	}
}

fn parse_value(bytes: &[u8], at: &mut usize, depth: usize) -> Result<Json, Error> {
	if depth > MAX_DEPTH {
		return Err(err(bytes, *at, "nesting too deep"));
	}
	match bytes.get(*at) {
		None => Err(err(bytes, *at, "unexpected end")),
		Some(b'{') => parse_obj(bytes, at, depth),
		Some(b'[') => parse_list(bytes, at, depth),
		Some(b'"') => Ok(Json::Str(parse_string(bytes, at)?)),
		Some(b't') => {
			expect_word(bytes, at, "true")?;
			Ok(Json::Bool(true))
		}
		Some(b'f') => {
			expect_word(bytes, at, "false")?;
			Ok(Json::Bool(false))
		}
		Some(b'n') => {
			expect_word(bytes, at, "null")?;
			Ok(Json::Null)
		}
		Some(_) => parse_number(bytes, at),
	}
}

fn expect_word(bytes: &[u8], at: &mut usize, word: &str) -> Result<(), Error> {
	if bytes.len() - *at < word.len() || &bytes[*at..*at + word.len()] != word.as_bytes() {
		return Err(err(bytes, *at, "unexpected token"));
	}
	*at += word.len();
	Ok(())
}

fn parse_number(bytes: &[u8], at: &mut usize) -> Result<Json, Error> {
	let start = *at;
	if *at < bytes.len() && bytes[*at] == b'-' {
		*at += 1;
	}
	let int_start = *at;
	while *at < bytes.len() && bytes[*at].is_ascii_digit() {
		*at += 1;
	}
	if *at == int_start {
		return Err(err(bytes, start, "bad number"));
	}
	if *at - int_start > 1 && bytes[int_start] == b'0' {
		return Err(err(bytes, start, "bad number"));
	}
	if *at < bytes.len() && bytes[*at] == b'.' {
		*at += 1;
		let frac_start = *at;
		while *at < bytes.len() && bytes[*at].is_ascii_digit() {
			*at += 1;
		}
		if *at == frac_start {
			return Err(err(bytes, start, "bad number"));
		}
	}
	if *at < bytes.len() && (bytes[*at] == b'e' || bytes[*at] == b'E') {
		*at += 1;
		if *at < bytes.len() && (bytes[*at] == b'+' || bytes[*at] == b'-') {
			*at += 1;
		}
		let exp_start = *at;
		while *at < bytes.len() && bytes[*at].is_ascii_digit() {
			*at += 1;
		}
		if *at == exp_start {
			return Err(err(bytes, start, "bad number"));
		}
	}
	let text = std::str::from_utf8(&bytes[start..*at]).map_err(|_| err(bytes, start, "bad number"))?;
	let value: f64 = text
		.parse()
		.map_err(|_| err(bytes, start, "bad number"))?;
	Ok(Json::Num(value))
}

fn parse_string(bytes: &[u8], at: &mut usize) -> Result<String, Error> {
	*at += 1;
	let mut out = String::new();
	loop {
		let byte = *bytes.get(*at).ok_or_else(|| err(bytes, *at, "unterminated string"))?;
		match byte {
			b'"' => {
				*at += 1;
				return Ok(out);
			}
			b'\\' => {
				*at += 1;
				let esc = *bytes
					.get(*at)
					.ok_or_else(|| err(bytes, *at, "unterminated escape"))?;
				*at += 1;
				match esc {
					b'"' => out.push('"'),
					b'\\' => out.push('\\'),
					b'/' => out.push('/'),
					b'b' => out.push('\u{8}'),
					b'f' => out.push('\u{c}'),
					b'n' => out.push('\n'),
					b'r' => out.push('\r'),
					b't' => out.push('\t'),
					b'u' => {
						let first = parse_hex4(bytes, at)?;
						let ch = if (0xD800..0xDC00).contains(&first) {
							if bytes.get(*at) == Some(&b'\\') && bytes.get(*at + 1) == Some(&b'u') {
								*at += 2;
								let second = parse_hex4(bytes, at)?;
								if !(0xDC00..0xE000).contains(&second) {
									return Err(err(bytes, *at, "bad surrogate pair"));
								}
								let combined =
									0x10000 + ((first - 0xD800) << 10) + (second - 0xDC00);
								char::from_u32(combined)
									.ok_or_else(|| err(bytes, *at, "bad surrogate pair"))?
							} else {
								return Err(err(bytes, *at, "lone surrogate"));
							}
						} else {
							char::from_u32(first).ok_or_else(|| err(bytes, *at, "bad escape"))?
						};
						out.push(ch);
					}
					_ => return Err(err(bytes, *at, "bad escape")),
				}
			}
			0x00..=0x1F => return Err(err(bytes, *at, "control character in string")),
			_ => {
				let start = *at;
				while *at < bytes.len() && bytes[*at] != b'"' && bytes[*at] != b'\\' && bytes[*at] >= 0x20 {
					*at += 1;
				}
				out.push_str(
					std::str::from_utf8(&bytes[start..*at])
						.map_err(|_| err(bytes, start, "bad utf-8"))?,
				);
			}
		}
	}
}

fn parse_hex4(bytes: &[u8], at: &mut usize) -> Result<u32, Error> {
	if *at + 4 > bytes.len() {
		return Err(err(bytes, *at, "bad escape"));
	}
	let mut value = 0u32;
	for index in 0..4 {
		let digit = (bytes[*at + index] as char)
			.to_digit(16)
			.ok_or_else(|| err(bytes, *at, "bad escape"))?;
		value = value * 16 + digit;
	}
	*at += 4;
	Ok(value)
}

fn parse_obj(bytes: &[u8], at: &mut usize, depth: usize) -> Result<Json, Error> {
	*at += 1;
	let mut entries: Vec<(String, Json)> = Vec::new();
	skip_space(bytes, at);
	if bytes.get(*at) == Some(&b'}') {
		*at += 1;
		return Ok(Json::Obj(entries));
	}
	loop {
		skip_space(bytes, at);
		if bytes.get(*at) != Some(&b'"') {
			return Err(err(bytes, *at, "expected key"));
		}
		let key = parse_string(bytes, at)?;
		skip_space(bytes, at);
		if bytes.get(*at) != Some(&b':') {
			return Err(err(bytes, *at, "expected colon"));
		}
		*at += 1;
		skip_space(bytes, at);
		let value = parse_value(bytes, at, depth + 1)?;
		entries.push((key, value));
		skip_space(bytes, at);
		match bytes.get(*at) {
			Some(b',') => *at += 1,
			Some(b'}') => {
				*at += 1;
				return Ok(Json::Obj(entries));
			}
			_ => return Err(err(bytes, *at, "expected comma or brace")),
		}
	}
}

fn parse_list(bytes: &[u8], at: &mut usize, depth: usize) -> Result<Json, Error> {
	*at += 1;
	let mut items: Vec<Json> = Vec::new();
	skip_space(bytes, at);
	if bytes.get(*at) == Some(&b']') {
		*at += 1;
		return Ok(Json::List(items));
	}
	loop {
		skip_space(bytes, at);
		items.push(parse_value(bytes, at, depth + 1)?);
		skip_space(bytes, at);
		match bytes.get(*at) {
			Some(b',') => *at += 1,
			Some(b']') => {
				*at += 1;
				return Ok(Json::List(items));
			}
			_ => return Err(err(bytes, *at, "expected comma or bracket")),
		}
	}
}

fn write_pretty(value: &Json, indent: usize, out: &mut String) {
	let pad = "\t".repeat(indent);
	let inner = "\t".repeat(indent + 1);
	match value {
		Json::Null => out.push_str("null"),
		Json::Bool(true) => out.push_str("true"),
		Json::Bool(false) => out.push_str("false"),
		Json::Num(n) => out.push_str(&format_num(*n)),
		Json::Str(s) => write_str(s, out),
		Json::List(items) => {
			if items.is_empty() {
				out.push_str("[]");
				return;
			}
			out.push_str("[\n");
			for (index, item) in items.iter().enumerate() {
				out.push_str(&inner);
				write_pretty(item, indent + 1, out);
				if index + 1 < items.len() {
					out.push(',');
				}
				out.push('\n');
			}
			out.push_str(&pad);
			out.push(']');
		}
		Json::Obj(entries) => {
			if entries.is_empty() {
				out.push_str("{}");
				return;
			}
			out.push_str("{\n");
			for (index, (key, item)) in entries.iter().enumerate() {
				out.push_str(&inner);
				write_str(key, out);
				out.push_str(": ");
				write_pretty(item, indent + 1, out);
				if index + 1 < entries.len() {
					out.push(',');
				}
				out.push('\n');
			}
			out.push_str(&pad);
			out.push('}');
		}
	}
}

fn format_num(n: f64) -> String {
	if n.fract() == 0.0 && n.abs() < 9_007_199_254_740_992.0 {
		format!("{}", n as i64)
	} else {
		format!("{n}")
	}
}

fn write_str(value: &str, out: &mut String) {
	out.push('"');
	for ch in value.chars() {
		match ch {
			'"' => out.push_str("\\\""),
			'\\' => out.push_str("\\\\"),
			'\n' => out.push_str("\\n"),
			'\r' => out.push_str("\\r"),
			'\t' => out.push_str("\\t"),
			'\u{8}' => out.push_str("\\b"),
			'\u{c}' => out.push_str("\\f"),
			c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
			c => out.push(c),
		}
	}
	out.push('"');
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn parses_scalars() {
		assert_eq!(parse("null").unwrap(), Json::Null);
		assert_eq!(parse("true").unwrap(), Json::Bool(true));
		assert_eq!(parse("false").unwrap(), Json::Bool(false));
		assert_eq!(parse("\"hi\"").unwrap(), Json::Str("hi".to_string()));
		assert_eq!(parse("42").unwrap(), Json::Num(42.0));
		assert_eq!(parse("-3.5").unwrap(), Json::Num(-3.5));
		assert_eq!(parse("1e2").unwrap(), Json::Num(100.0));
	}

	#[test]
	fn parses_nested() {
		let value = parse(r#"{"a": [1, {"b": "c"}], "d": null}"#).unwrap();
		let obj = value.as_obj().unwrap();
		assert_eq!(obj.len(), 2);
		let list = value.get("a").unwrap().as_list().unwrap();
		assert_eq!(list.len(), 2);
		assert_eq!(list[1].get("b").unwrap().as_str(), Some("c"));
		assert!(value.get("d").unwrap().is_null());
	}

	#[test]
	fn parses_escapes_and_unicode() {
		let value = parse(r#""line\nq\"uote\u0041\u00e9\ud83d\ude00""#).unwrap();
		assert_eq!(value.as_str().unwrap(), "line\nq\"uoteA\u{e9}\u{1f600}");
	}

	#[test]
	fn rejects_bad_input() {
		assert!(parse("").is_err());
		assert!(parse("{").is_err());
		assert!(parse("[1,]").is_err());
		assert!(parse("{\"a\" 1}").is_err());
		assert!(parse("1 2").is_err());
		assert!(parse("\"\\q\"").is_err());
		assert!(parse("\"abc").is_err());
		assert!(parse("01").is_err());
	}

	#[test]
	fn writer_roundtrips() {
		let source = r#"{"name":"devlab","count":3,"pi":3.5,"on":true,"none":null,"items":[1,2],"nested":{"k":"v\n"}}"#;
		let value = parse(source).unwrap();
		let printed = value.to_string_pretty();
		assert_eq!(parse(&printed).unwrap(), value);
	}

	#[test]
	fn set_updates_or_appends() {
		let mut value = Json::obj();
		value.set("a", Json::from(1.0));
		value.set("b", Json::from("x"));
		value.set("a", Json::from(2.0));
		assert_eq!(value.get("a").unwrap().as_num(), Some(2.0));
		assert_eq!(value.get("b").unwrap().as_str(), Some("x"));
	}

	#[test]
	fn deep_nesting_is_rejected() {
		let deep = "[".repeat(200) + &"]".repeat(200);
		assert!(parse(&deep).is_err());
	}
}
