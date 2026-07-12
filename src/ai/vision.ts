import ollama from "ollama";

/**
 * Describe an image using Gemma 3 Vision.
 * Returns a text description that can be injected into the reply prompt.
 */
export async function describeImage(imagePath: string): Promise<string> {
  const response = await ollama.chat({
    model: "gemma3:4b",
    messages: [
      {
        role: "user",
        content: `
Describe this image for a social media AI.

Focus on:
- what is happening
- important people
- emotions
- visible text
- meme context
- anything useful for writing a reply
        `,
        images: [imagePath]
      }
    ]
  });

  return response.message.content.trim();
}

/**
 * Describe multiple images and return combined descriptions.
 */
export async function describeImages(imagePaths: string[]): Promise<string[]> {
  const descriptions: string[] = [];
  for (const path of imagePaths) {
    const desc = await describeImage(path);
    descriptions.push(desc);
  }
  return descriptions;
}