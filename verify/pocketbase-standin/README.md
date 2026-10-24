# PocketBase stand-in (item 3-6)

The PocketBase-based `cms-client` in production is not part of this sandbox.
This directory holds a stand-in written from the contract in the requirements
(§0-4): the same package name, version and public surface, implemented against
PocketBase's REST shape (`/api/collections/<c>/records`, `/api/files/...`).

`mock-server.mjs` serves PocketBase-shaped records. `verify/item3-cms-client.mjs`
fills it from the same content the EmDash build used, builds `site/` once with
each tarball, and compares the output. It shows that `site/` builds unchanged
against either implementation of the contract; it does not exercise the real
production package.
