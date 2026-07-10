// import { getPage } from "./browser";

// async function main() {
//     const page = await getPage();

//     await page.goto("https://x.com");

//     console.log(
//         "Please log into X manually if necessary."
//     );

//     await page.pause();
// }

// main();
import { getPage } from "./browser";

async function main() {
  const page = await getPage();

  await page.goto("https://x.com/home");

  await page.waitForLoadState("domcontentloaded");

  console.log("Title:", await page.title());

  // Wait for the search box to appear
  const search = page.getByPlaceholder("Search");
  await search.waitFor({ timeout: 10000 });

  // Type into it
  await search.click();
  await search.fill("OpenAI");

  console.log("Typed into search box.");

  await page.waitForTimeout(10000);
}

main();