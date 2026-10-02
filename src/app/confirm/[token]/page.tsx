import Customer from "@/components/merchant/Customer";
export default async function CustomerPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <Customer token={token} />;
}
