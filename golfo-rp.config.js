/**
 * `golfo-rp create-version` configuration of golfo-rp itself: validate with
 * `pnpm check`, then publish to npm from the `release.yml` workflow through npm
 * trusted publishing (OIDC), so no npm token is stored in the repository.
 *
 * @module golfo-rp.config
 */

/** @type {import("./src/create-version/config.js").CreateVersionConfig} */
export default {
  releaseTypeDescriptions: {
    patch: "Solo arreglos o cambios internos; la API pública no cambia.",
    minor: "Funcionalidades nuevas compatibles; lo existente sigue funcionando igual.",
    major: "Cambio incompatible en la API pública o en el comportamiento del CLI.",
  },
  checks: ["pnpm check"],
  publish: "npm",
  publication: { authentication: "oidc" },
  summary: ["Consumidores: pnpm add -D @golfo/rp@^{version}"],
};

/** GitHub Actions workflow used by create-version. */
export const ci = {"workflow":"release.yml","secrets":[],"variables":[],"deployment":null};
