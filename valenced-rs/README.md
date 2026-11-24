# valenced-rs

Valenced rewritten in Rust, for Discord Phoenix.

Discord's Android alpha runs Phoenix, a native Rust client. The old stack (an
Xposed module over the React Native app, Kotlin natives, the JS plugin API) has
nothing left to hook, and the community already proved the new surface: patch
the APK, swap the native loader in through a library rename, hook the gateway
registry, and drive the UI through Phoenix's own bridge. This workspace is the
Valenced take on that world: the plugin platform (manifests, versions, pools,
storage, a host runtime) rebuilt as a Rust core with a test suite that runs on
every push.

Prior art worth reading first:

- [phoenix-unlock](https://github.com/mantikafasi/phoenix-unlock): the APK
  patcher, the `libplm.so` loader, the QuickJS plugin runtime and the Phoenix
  schema docs.
- [cinder](https://github.com/mufarodev/cinder): a Rust runtime with a C-ABI
  plugin API and a bridge loader for the same client.
- [valenced (phoenix branch)](https://github.com/thororen1234/valenced/tree/phoenix):
  the existing stack being pushed toward Phoenix.

## Layout

| Crate | What |
| --- | --- |
| `crates/core` | Manifest format, segment versions with prerelease runs, requirement ranges, JSON, storage merge semantics, lifecycle, event dispatcher, SHA-256. |
| `crates/host` | The runtime: guests, the host API (log, storage, settings, bridge methods), filtered event dispatch, error capture. |
| `crates/patch` | The patch engine: wildcard byte patterns, ELF `DT_NEEDED` renames, declarative patch scripts with expected match counts. |
| `crates/pool` | The pool: index model (plugins, versions, channels, urls, hashes) and dependency resolution into install plans. |
| `crates/cli` | The `valenced` binary: `plan`, `patch`, `verify`, `doctor`. |

Everything here is std-only, so the workspace builds anywhere without a crate
registry. The test suite covers the manifest language, the version and range
rules, storage merging, the dispatcher filters, the full guest lifecycle, byte
patching against synthetic ELF files, pool resolution and the CLI.

## The plugin model

Manifests stay recognizable from the old world:

```json
{
	"format": 1,
	"id": "com.shin.devlab",
	"name": "DevLab",
	"version": "2.0.0",
	"dependencies": {
		"valenced.api": { "version": ">=1 <2" }
	},
	"dist": {
		"script": "index.js",
		"phoenix": { "guest": "guest.wasm" }
	}
}
```

Versions take any number of segments and carry prerelease labels that compare
by digit runs (`rc9 < rc10`). Requirements are whitespace separated conditions
(`>=1 <2`, `*`). The pool is a repository of manifests with channels, download
urls, sizes and hashes; `valenced plan` resolves a request plus its dependency
closure into a topologically ordered install plan.

Patches are data. A script asserts how many times each pattern must match and
fails the build otherwise:

```json
{
	"name": "unlock",
	"ops": [
		{ "kind": "replace", "target": "lib/arm64-v8a/liblibdiscord_wasm_host.so", "pattern": "b8 ?? ?? ?? ?? c3", "with": "b8 01 00 00 00 c3", "expect": 1 },
		{ "kind": "rename_needed", "target": "lib/arm64-v8a/liblibdiscord_wasm_host.so", "from": "liblog.so", "to": "libplm.so" }
	]
}
```

## Building

```
cargo build --workspace --manifest-path valenced-rs/Cargo.toml
cargo test --workspace --manifest-path valenced-rs/Cargo.toml
```

CI runs both on every change and posts the compiler tail on the pull request
when something breaks.

## Roadmap

- A guest runtime for plugin payloads (QuickJS or wasm) behind the `Guest` trait
  that `valenced-host` already speaks.
- Phoenix wire and UI-op codecs so plugins can mount rows, buttons and settings
  pages through the Mana bridge, with the schema extractor output as the
  reference.
- The APK pipeline end to end: split merge, patch script application, re-sign
  with proof of rotation.
- A manager CLI and pool publishing that mirror the old repo flow.
- TypeScript definitions and a bundle step for plugin authors, so existing
  Valenced plugins port with minimal churn.
