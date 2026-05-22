import { sendChatRequest, ChatMessage } from '../agent/client.js';

/**
 * Uses the active completions client to analyze the scrubbed diff/content of a drifted file
 * and returns direct, technical security and architectural advice.
 */
export async function getDriftAdvice(filePath: string, scrubbedContent: string, diffText: string): Promise<string> {
  const systemPrompt = `You are Jules, a senior software architect and workspace security expert.
Analyze the provided code diff for the file "${filePath}" and summarize its safety.
Focus on:
1. Code health and potential bugs/flaws introduced by these changes.
2. Breaking configurations in critical APIs (if any).
3. Secret or high-entropy leaks that were not caught by static engines.
Summarize your findings in 2-3 concise bullet points. Be direct, technical, and actionable. Do not output anything other than the bullet points. Do not include any greeting or conversational filler.`;

  const userPrompt = `File: ${filePath}

Scrubbed Content (Reference):
\`\`\`
${scrubbedContent}
\`\`\`

Diff:
\`\`\`diff
${diffText}
\`\`\``;

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ];

  try {
    const response = await sendChatRequest(messages, []);
    return response.content || 'No advice returned.';
  } catch (err: any) {
    return `• Error generating drift advice: ${err.message}`;
  }
}
