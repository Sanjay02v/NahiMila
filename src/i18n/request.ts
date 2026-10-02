import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { messages } from "./messages";
export default getRequestConfig(async () => {
  const selected = (await cookies()).get("nml_locale")?.value;
  const locale = selected === "kn" || selected === "hi" ? selected : "en";
  return { locale, messages: messages[locale], timeZone: "Asia/Kolkata" };
});
