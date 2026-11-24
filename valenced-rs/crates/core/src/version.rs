use crate::Error;
use std::cmp::Ordering;
use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Version {
	pub segments: Vec<u64>,
	pub prerelease: Option<String>,
}

impl Version {
	pub fn parse(text: &str) -> Result<Version, Error> {
		let trimmed = text.trim();
		if trimmed.is_empty() {
			return Err(Error::new("version: empty string"));
		}
		let (main, prerelease) = match trimmed.split_once('-') {
			Some((main, pre)) => {
				if pre.is_empty() {
					return Err(Error::new(format!("version: empty prerelease in {text}")));
				}
				(main, Some(pre.to_string()))
			}
			None => (trimmed, None),
		};
		let mut segments = Vec::new();
		for part in main.split('.') {
			if part.is_empty() || !part.bytes().all(|b| b.is_ascii_digit()) {
				return Err(Error::new(format!("version: bad segment in {text}")));
			}
			segments.push(
				part.parse::<u64>()
					.map_err(|_| Error::new(format!("version: bad segment in {text}")))?,
			);
		}
		Ok(Version {
			segments,
			prerelease,
		})
	}

	pub fn compare(&self, other: &Version) -> Ordering {
		let len = self.segments.len().max(other.segments.len());
		for index in 0..len {
			let mine = self.segments.get(index).copied().unwrap_or(0);
			let theirs = other.segments.get(index).copied().unwrap_or(0);
			match mine.cmp(&theirs) {
				Ordering::Equal => {}
				order => return order,
			}
		}
		match (&self.prerelease, &other.prerelease) {
			(None, None) => Ordering::Equal,
			(None, Some(_)) => Ordering::Greater,
			(Some(_), None) => Ordering::Less,
			(Some(a), Some(b)) => compare_runs(a, b),
		}
	}
}

impl Ord for Version {
	fn cmp(&self, other: &Version) -> Ordering {
		self.compare(other)
	}
}

impl PartialOrd for Version {
	fn partial_cmp(&self, other: &Version) -> Option<Ordering> {
		Some(self.compare(other))
	}
}

impl fmt::Display for Version {
	fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
		let mut first = true;
		for segment in &self.segments {
			if !first {
				write!(f, ".")?;
			}
			write!(f, "{segment}")?;
			first = false;
		}
		if let Some(pre) = &self.prerelease {
			write!(f, "-{pre}")?;
		}
		Ok(())
	}
}

fn runs(text: &str) -> Vec<(bool, String)> {
	let mut out: Vec<(bool, String)> = Vec::new();
	let mut chars = text.chars().peekable();
	while let Some(ch) = chars.next() {
		let digit = ch.is_ascii_digit();
		let mut run = String::new();
		run.push(ch);
		while let Some(next) = chars.peek() {
			if next.is_ascii_digit() == digit {
				run.push(*next);
				chars.next();
			} else {
				break;
			}
		}
		out.push((digit, run));
	}
	out
}

fn compare_runs(a: &str, b: &str) -> Ordering {
	let left = runs(a);
	let right = runs(b);
	let len = left.len().max(right.len());
	for index in 0..len {
		match (left.get(index), right.get(index)) {
			(None, None) => return Ordering::Equal,
			(None, Some(_)) => return Ordering::Less,
			(Some(_), None) => return Ordering::Greater,
			(Some((ld, lt)), Some((rd, rt))) => {
				if *ld && *rd {
					let ln = lt.trim_start_matches('0');
					let rn = rt.trim_start_matches('0');
					match ln.len().cmp(&rn.len()) {
						Ordering::Equal => match ln.cmp(rn) {
							Ordering::Equal => {}
							order => return order,
						},
						order => return order,
					}
				} else if !*ld && !*rd {
					match lt.cmp(rt) {
						Ordering::Equal => {}
						order => return order,
					}
				} else if *ld {
					return Ordering::Greater;
				} else {
					return Ordering::Less;
				}
			}
		}
	}
	Ordering::Equal
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Op {
	Eq,
	Ge,
	Le,
	Gt,
	Lt,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Cond {
	pub op: Op,
	pub version: Version,
}

impl Cond {
	pub fn matches(&self, version: &Version) -> bool {
		let order = version.compare(&self.version);
		match self.op {
			Op::Eq => order == Ordering::Equal,
			Op::Ge => order != Ordering::Less,
			Op::Le => order != Ordering::Greater,
			Op::Gt => order == Ordering::Greater,
			Op::Lt => order == Ordering::Less,
		}
	}
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Requirement {
	pub conds: Vec<Cond>,
}

impl Requirement {
	pub fn any() -> Requirement {
		Requirement { conds: Vec::new() }
	}

	pub fn parse(text: &str) -> Result<Requirement, Error> {
		let trimmed = text.trim();
		if trimmed.is_empty() || trimmed == "*" {
			return Ok(Requirement::any());
		}
		let mut conds = Vec::new();
		for token in trimmed.split_whitespace() {
			let (op, rest) = if let Some(rest) = token.strip_prefix(">=") {
				(Op::Ge, rest)
			} else if let Some(rest) = token.strip_prefix("<=") {
				(Op::Le, rest)
			} else if let Some(rest) = token.strip_prefix('>') {
				(Op::Gt, rest)
			} else if let Some(rest) = token.strip_prefix('<') {
				(Op::Lt, rest)
			} else if let Some(rest) = token.strip_prefix('=') {
				(Op::Eq, rest)
			} else {
				(Op::Eq, token)
			};
			conds.push(Cond {
				op,
				version: Version::parse(rest)?,
			});
		}
		Ok(Requirement { conds })
	}

	pub fn matches(&self, version: &Version) -> bool {
		self.conds.iter().all(|cond| cond.matches(version))
	}
}

impl fmt::Display for Requirement {
	fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
		if self.conds.is_empty() {
			return write!(f, "*");
		}
		let mut first = true;
		for cond in &self.conds {
			if !first {
				write!(f, " ")?;
			}
			let op = match cond.op {
				Op::Eq => "=",
				Op::Ge => ">=",
				Op::Le => "<=",
				Op::Gt => ">",
				Op::Lt => "<",
			};
			write!(f, "{op}{}", cond.version)?;
			first = false;
		}
		Ok(())
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	fn v(text: &str) -> Version {
		Version::parse(text).unwrap()
	}

	#[test]
	fn segments_compare_numerically() {
		assert_eq!(v("1.0.0").compare(&v("1.0")), Ordering::Equal);
		assert_eq!(v("1.10").compare(&v("1.9")), Ordering::Greater);
		assert_eq!(v("2.0").compare(&v("1.99.99")), Ordering::Greater);
		assert_eq!(v("1.0.1").compare(&v("1.0.0")), Ordering::Greater);
	}

	#[test]
	fn prereleases_sort_below_releases() {
		assert_eq!(v("1.0.0-rc1").compare(&v("1.0.0")), Ordering::Less);
		assert_eq!(v("1.0.0-rc2").compare(&v("1.0.0-rc1")), Ordering::Greater);
		assert_eq!(v("1.0.0-rc10").compare(&v("1.0.0-rc9")), Ordering::Greater);
		assert_eq!(v("1.0.0-beta").compare(&v("1.0.0-rc")), Ordering::Less);
		assert_eq!(v("1.0.0-alpha1").compare(&v("1.0.0-alpha1")), Ordering::Equal);
	}

	#[test]
	fn digit_runs_compare_numerically() {
		assert_eq!(v("1.0.0-r2").compare(&v("1.0.0-r10")), Ordering::Less);
		assert_eq!(v("1.0.0-r007").compare(&v("1.0.0-r7")), Ordering::Equal);
		assert_eq!(v("1.0.0-a").compare(&v("1.0.0-a1")), Ordering::Less);
	}

	#[test]
	fn parses_and_rejects() {
		assert!(Version::parse("").is_err());
		assert!(Version::parse("1..2").is_err());
		assert!(Version::parse("1.a").is_err());
		assert!(Version::parse("1-").is_err());
		assert!(Version::parse("1.2.3-rc.1").is_ok());
	}

	#[test]
	fn requirements_match() {
		let req = Requirement::parse(">=1 <2").unwrap();
		assert!(req.matches(&v("1.5.0")));
		assert!(!req.matches(&v("2.0.0")));
		assert!(!req.matches(&v("0.9.0")));
		let any = Requirement::parse("*").unwrap();
		assert!(any.matches(&v("99.0.0-rc1")));
		let exact = Requirement::parse("1.2").unwrap();
		assert!(exact.matches(&v("1.2")));
		assert!(exact.matches(&v("1.2.0")));
		assert!(!exact.matches(&v("1.2.1")));
		let prerelease = Requirement::parse(">=1.0.0-rc1").unwrap();
		assert!(prerelease.matches(&v("1.0.0")));
		assert!(prerelease.matches(&v("1.0.0-rc2")));
		assert!(!prerelease.matches(&v("1.0.0-rc0")));
	}

	#[test]
	fn display_roundtrips() {
		let req = Requirement::parse(">=1 <2").unwrap();
		assert_eq!(Requirement::parse(&req.to_string()).unwrap(), req);
		assert_eq!(v("1.2.3-rc1").to_string(), "1.2.3-rc1");
	}
}
