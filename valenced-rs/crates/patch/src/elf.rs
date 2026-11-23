use valenced_core::Error;

const PT_LOAD: u32 = 1;
const PT_DYNAMIC: u32 = 2;
const DT_NULL: u64 = 0;
const DT_NEEDED: u64 = 1;
const DT_STRTAB: u64 = 5;

struct Phdr {
	p_type: u32,
	p_offset: u64,
	p_vaddr: u64,
	p_filesz: u64,
}

pub fn rename_needed(data: &mut [u8], from: &str, to: &str) -> Result<usize, Error> {
	if from.len() != to.len() {
		return Err(Error::new(format!(
			"elf: rename must keep the length ({from} to {to})"
		)));
	}
	if data.len() < 64 || &data[0..4] != b"\x7fELF" {
		return Err(Error::new("elf: not an elf file"));
	}
	if data[4] != 2 {
		return Err(Error::new("elf: only 64-bit files are supported"));
	}
	let little = data[5] == 1;
	if !little {
		return Err(Error::new("elf: only little-endian files are supported"));
	}
	let phoff = read_u64(data, 0x20)?;
	let phentsize = read_u16(data, 0x36)? as usize;
	let phnum = read_u16(data, 0x38)? as usize;
	if phentsize < 56 || phoff == 0 || phnum == 0 {
		return Err(Error::new("elf: bad program headers"));
	}
	let mut phdrs = Vec::new();
	for index in 0..phnum {
		let at = phoff as usize + index * phentsize;
		phdrs.push(Phdr {
			p_type: read_u32(data, at)?,
			p_offset: read_u64(data, at + 8)?,
			p_vaddr: read_u64(data, at + 16)?,
			p_filesz: read_u64(data, at + 32)?,
		});
	}
	let dynamic = phdrs
		.iter()
		.find(|p| p.p_type == PT_DYNAMIC)
		.ok_or_else(|| Error::new("elf: no dynamic segment"))?;
	let mut strtab_vaddr = None;
	let mut needed: Vec<u64> = Vec::new();
	let mut at = dynamic.p_offset as usize;
	loop {
		let tag = read_u64(data, at)?;
		let val = read_u64(data, at + 8)?;
		match tag {
			DT_NULL => break,
			DT_NEEDED => needed.push(val),
			DT_STRTAB => strtab_vaddr = Some(val),
			_ => {}
		}
		at += 16;
	}
	let strtab_vaddr =
		strtab_vaddr.ok_or_else(|| Error::new("elf: no string table"))?;
	let strtab_off = vaddr_to_offset(&phdrs, strtab_vaddr)
		.ok_or_else(|| Error::new("elf: string table outside loads"))? as usize;
	let mut renamed = 0usize;
	for offset in needed {
		let at = strtab_off + offset as usize;
		let end = find_cstr_end(data, at)?;
		let entry = std::str::from_utf8(&data[at..end])
			.map_err(|_| Error::new("elf: bad string table entry"))?;
		if entry == from {
			data[at..end].copy_from_slice(to.as_bytes());
			renamed += 1;
		}
	}
	if renamed == 0 {
		return Err(Error::new(format!("elf: {from} is not needed")));
	}
	Ok(renamed)
}

fn vaddr_to_offset(phdrs: &[Phdr], vaddr: u64) -> Option<u64> {
	phdrs
		.iter()
		.filter(|p| p.p_type == PT_LOAD)
		.find(|p| vaddr >= p.p_vaddr && vaddr < p.p_vaddr + p.p_filesz)
		.map(|p| p.p_offset + (vaddr - p.p_vaddr))
}

fn find_cstr_end(data: &[u8], at: usize) -> Result<usize, Error> {
	let mut end = at;
	while end < data.len() && data[end] != 0 {
		end += 1;
	}
	if end >= data.len() {
		return Err(Error::new("elf: unterminated string"));
	}
	Ok(end)
}

fn read_u16(data: &[u8], at: usize) -> Result<u16, Error> {
	let bytes = data
		.get(at..at + 2)
		.ok_or_else(|| Error::new("elf: truncated"))?;
	Ok(u16::from_le_bytes([bytes[0], bytes[1]]))
}

fn read_u32(data: &[u8], at: usize) -> Result<u32, Error> {
	let bytes = data
		.get(at..at + 4)
		.ok_or_else(|| Error::new("elf: truncated"))?;
	Ok(u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
}

fn read_u64(data: &[u8], at: usize) -> Result<u64, Error> {
	let bytes = data
		.get(at..at + 8)
		.ok_or_else(|| Error::new("elf: truncated"))?;
	Ok(u64::from_le_bytes([
		bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
	]))
}

#[cfg(test)]
mod tests {
	use super::*;

	fn synthetic_elf() -> Vec<u8> {
		let mut data = vec![0u8; 512];
		data[0..4].copy_from_slice(b"\x7fELF");
		data[4] = 2;
		data[5] = 1;
		data[6] = 1;
		write_u16(&mut data, 0x10, 3);
		write_u16(&mut data, 0x36, 56);
		write_u16(&mut data, 0x38, 2);
		write_u64(&mut data, 0x20, 64);
		write_u32(&mut data, 64, PT_LOAD);
		write_u64(&mut data, 64 + 8, 0);
		write_u64(&mut data, 64 + 16, 0);
		write_u64(&mut data, 64 + 32, 512);
		write_u32(&mut data, 120, PT_DYNAMIC);
		write_u64(&mut data, 120 + 8, 256);
		write_u64(&mut data, 120 + 16, 256);
		write_u64(&mut data, 120 + 32, 64);
		write_u64(&mut data, 256, DT_NEEDED);
		write_u64(&mut data, 256 + 8, 1);
		write_u64(&mut data, 272, DT_NEEDED);
		write_u64(&mut data, 272 + 8, 11);
		write_u64(&mut data, 288, DT_STRTAB);
		write_u64(&mut data, 288 + 8, 320);
		write_u64(&mut data, 304, DT_NULL);
		write_u64(&mut data, 304 + 8, 0);
		data[321..330].copy_from_slice(b"liblog.so");
		data[331..340].copy_from_slice(b"libc.so.6");
		data
	}

	fn write_u16(data: &mut [u8], at: usize, value: u16) {
		data[at..at + 2].copy_from_slice(&value.to_le_bytes());
	}

	fn write_u32(data: &mut [u8], at: usize, value: u32) {
		data[at..at + 4].copy_from_slice(&value.to_le_bytes());
	}

	fn write_u64(data: &mut [u8], at: usize, value: u64) {
		data[at..at + 8].copy_from_slice(&value.to_le_bytes());
	}

	#[test]
	fn renames_needed_entry() {
		let mut data = synthetic_elf();
		let count = rename_needed(&mut data, "liblog.so", "libplm.so").unwrap();
		assert_eq!(count, 1);
		assert_eq!(&data[321..330], b"libplm.so");
		assert_eq!(&data[331..340], b"libc.so.6");
	}

	#[test]
	fn rejects_length_change_and_missing() {
		let mut data = synthetic_elf();
		assert!(rename_needed(&mut data, "liblog.so", "libplugin.so").is_err());
		assert!(rename_needed(&mut data, "libnope.so", "libplm.so").is_err());
	}
}
