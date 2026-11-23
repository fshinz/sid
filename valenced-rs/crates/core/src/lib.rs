pub mod json;
pub mod lifecycle;
pub mod manifest;
pub mod sha256;
pub mod storage;
pub mod version;

use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Error {
	message: String,
}

impl Error {
	pub fn new(message: impl Into<String>) -> Error {
		Error {
			message: message.into(),
		}
	}

	pub fn message(&self) -> &str {
		&self.message
	}
}

impl fmt::Display for Error {
	fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
		write!(f, "{}", self.message)
	}
}

impl std::error::Error for Error {}
