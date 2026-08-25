# Vendored Starknet Privacy packages

MorokPay's isolated `/privacy-sdk-lab` uses packages built from the signed
`PRIVACY-0.14.3-RC.5` tag of
`starkware-libs/starknet-privacy` (commit
`66e3caae8c0201227a6719696d004e30d90aea65`). They are vendored because the
public GitHub npm registry still requires an authentication token; no token is
stored in this repository or required by Vercel.

## Files

- `starkware-libs-starknet-privacy-client-0.1.0.tgz`
  - built without source changes
  - SHA-256: `1807D2875C983E2CB4C646D933A238C3A98B0840E473744DBA385FF474D599AE`
- `upstream/starkware-libs-starknet-privacy-sdk-0.14.3-rc.5.tgz`
  - unmodified package produced from the tag
  - SHA-256: `64D142A726CA63DA88115F2276ACC49AB58812FDC8AFA8DE002FF3D7E2C08200`
- `starkware-libs-starknet-privacy-sdk-0.14.3-rc.5.tgz`
  - same compiled SDK runtime as the upstream tarball
  - packaging-only patch: removes `starknet-devnet` from production
    dependencies; it is imported only by the explicit Node testing/devnet
    export and is not part of MorokPay's browser path
  - SHA-256: `3F58805813E9E0D6CB82A4FA637984F16CF8870034521F0AC1D83F2EE128D4A9`

The packaging patch avoids installing `starknet-devnet -> decompress`, for
which `npm audit` reports critical archive-extraction vulnerabilities with no
available fix. The unmodified tarball is retained for provenance and diffing.
