import { twitterV2 } from "./TwitterClient";

async function main() {
  const me = await twitterV2.me();

  console.log(me.data);
}

main().catch(console.error);