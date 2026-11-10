import nextConfig from "eslint-config-next";

const config = [{ ignores: ["mock-provider/**", "node_modules/**", ".next/**"] }, ...nextConfig];

export default config;
