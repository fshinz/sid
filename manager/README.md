# Valenced Manager

Browser manager for the Valenced Phoenix build. It downloads the main files, takes the plugins and
patch pack you pick, runs the patches at the end over the merged build, and hands back a signed APK.
Everything runs client side, nothing is uploaded.

## Flow

1. Main files. Pick the Discord split APKs you downloaded (base, config splits). Automatic download
   is not available because the CDN does not send CORS headers.
2. Configure. Densities and languages you leave unpicked are pruned from the merge. Next to Discord
   renames the package in the binary manifest so the build installs beside your normal Discord;
   Replace Discord keeps the package and installs over it after an uninstall.
3. Plugins. A pool index lists plugins with per channel dist urls (url, size, sha256). Selected
   plugins are downloaded, hash checked and packed into `assets/valenced/plugins` together with
   `assets/valenced/index.json`. Custom scripts are packed next to them.
4. Patches. The patch pack runs at the end over the merged build. Each step is checked against its
   expect count and the run fails on any mismatch.
5. Output. The build is zip aligned, signed with APK Signature Scheme v3 (RSASSA-PKCS1-v1_5 with
   SHA-256, id 0x0103) and self verified before download. The signing key and certificate are
   offered as PEM. There is no proof-of-rotation lineage yet, so updating over an older build signed
   by a different key needs a uninstall first.

## Patch pack format

```json
{
	"format": 1,
	"id": "example-access-gate",
	"target": "356207",
	"steps": [
		{ "file": "lib/arm64-v8a/liblog.so", "op": "rename_needed", "from": "liblog.so", "to": "libvld.so", "expect": 1 },
		{ "file": "lib/arm64-v8a/libhost.so", "op": "replace", "pattern": "48 89 ?? 48 8b", "with": "48 87 ?? 48 8b", "expect": 2 },
		{ "file": "AndroidManifest.xml", "op": "assert", "text": "com.discord.release", "expect": 1 }
	]
}
```

- `replace` matches `pattern` (hex bytes, `??` wildcards) and writes `with` over the hit, keeping the
  original byte where `with` has a wildcard. Pattern and replacement lengths must match.
- `rename_needed` rewrites one DT_NEEDED name in the ELF64 dynamic string table. The name length must
  stay identical, matching the loader injection trick (rename an existing dependency to your loader).
- `assert` counts `contains` (hex pattern) or `text` (utf8) occurrences and checks `expect`.

## Pool index format

```json
{
	"format": 1,
	"plugins": [
		{
			"id": "example",
			"version": "1.0.0",
			"name": "Example",
			"description": "What it does",
			"author": "you",
			"channels": {
				"stable": { "url": "https://host/example.js", "size": 1234, "sha256": "..." }
			}
		}
	]
}
```

The channel you pick is preferred, then stable, beta, canary. size and sha256 are enforced when set.

## Engine notes

The engine is the TypeScript twin of `valenced-rs/patch` and `valenced-rs/pool`, with two deliberate
differences: the ELF string table address is translated through PT_LOAD segments (virtual address to
file offset) so it works on real binaries, and string table renames only touch full entries.
`bun test manager/tests` holds the spec, including an independent chunk digest implementation for the
signing scheme.

## Development

```sh
bun test manager/tests
npx tsc -p manager/tsconfig.json
bun manager/serve.ts
```

The dev server transpiles TypeScript on the fly, so there is no build step. Verify a produced APK
with `apksigner verify --print-certs` if you want a second opinion.
