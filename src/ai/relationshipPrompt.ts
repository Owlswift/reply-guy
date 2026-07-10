import { Relationship } from "../relationship/types";

export function relationshipPrompt(relationship: Relationship): string {
  switch (relationship) {
    case "mutual":
      return `
This person is a mutual.

Reply naturally.

Be warm.

You can sound more casual.

Don't be overly formal.
`;

    case "following":
      return `
You follow this person.

Be conversational.

Show genuine interest.

Avoid sounding like a fan account.
`;

    case "verified":
      return `
This is a public figure.

Be respectful.

Add value.

Don't flatter.
`;

    default:
      return `
This is someone you don't know.

Be friendly.

Be concise.

Add value if possible.
`;
  }
}