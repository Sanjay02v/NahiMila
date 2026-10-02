// Render runs this before starting Next. Report setting names, never their values.
const required = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
];
const missing = required.filter((name) => !process.env[name]?.trim());
if (missing.length) {
  console.error(
    `Configure these Render environment settings first: ${missing.join(", ")}`,
  );
  process.exitCode = 1;
} else {
  console.log("Hosted database and account settings are present.");
}
