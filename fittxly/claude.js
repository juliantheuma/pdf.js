import Anthropic from '@anthropic-ai/sdk';

// Claude vision client & config
const anthropicClient = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const CLAUDE_MODEL = "claude-haiku-4-5";

const CLAUDE_SYSTEM_PROMPT = `You are a document data extraction tool.
Extract the following fields from the document image:

Personal details:
  - name
  - spouse
  - father
  - mother
  - id_card
  - birthplace
  - date_of_birth  (normalise to YYYY-MM-DD)

Date fields (normalise all to YYYY-MM-DD):
  - liabilities_from
  - liabilities_to
  - transfers_from
  - transfers_to
  - fidi_from
  - fidi_to

Return ONLY a JSON object with these exact keys.
Name can be either a human's name or a company name.
If the name is a company name, set document_type to "COMPANY".
If the name is a human's name, set document_type to "INDIVIDUAL".
If a field is not found or not applicable, set its value to null.
document_type must always be either "COMPANY" or "INDIVIDUAL".
Make sure that the dates are correct, and the numbers are correct.
Make sure that the dates are in the correct format YYYY-MM-DD, Where MM is 01-12 and DD is 01-31.
Do not include any explanation or extra text — only the JSON object.`;

export async function extractDatesFromImageBuffer(imageBuffer, mediaType = "image/png") {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn("ANTHROPIC_API_KEY is not set; skipping suggestions extraction.");
    return null;
  }

  const base64Data = imageBuffer.toString("base64");

  const response = await anthropicClient.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1024,
    system: CLAUDE_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: mediaType,
              data: base64Data,
            },
          },
          {
            type: "text",
            text: "Extract the liabilities, transfers, and fidi date fields from this document.",
          },
        ],
      },
    ],
  });

  const firstContent = response.content?.[0];
  const text = (firstContent && firstContent.type === "text" && firstContent.text?.trim()) || "";

  if (!text) {
    console.warn("Claude response had no text content.");
    return null;
  }

  let dates = null;
  try {
    console.log("CLAUDE text: ", text)
    dates = JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        dates = JSON.parse(match[0]);
      } catch {
        console.warn("Failed to parse JSON from Claude response substring.");
      }
    } else {
      console.warn("Could not find JSON object in Claude response:", text);
    }
  }

  if (!dates || typeof dates !== "object") {
    dates = null;
  }

  const usage = response.usage;
  if (usage) {
    console.log(
      `Claude tokens — input: ${usage.input_tokens}, output: ${usage.output_tokens}`
    );
  }

  return dates;
}
