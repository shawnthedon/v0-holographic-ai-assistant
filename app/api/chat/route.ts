import { NextRequest, NextResponse } from 'next/server';

interface ChatRequest {
  message: string;
  model: string;
  endpoint?: string;
  messages?: Array<{ role: string; content: string }>;
}

export async function POST(request: NextRequest) {
  try {
    const body: ChatRequest = await request.json();
    const { message, model, endpoint, messages = [] } = body;

    console.log('[v0] Chat API called with model:', model);

    if (!message) {
      return NextResponse.json(
        { error: 'Message is required' },
        { status: 400 }
      );
    }

    // Route to appropriate LLM provider
    let response: string;

    if (model === 'gemini-2.0-flash') {
      response = await callGemini(message, messages);
    } else if (model === 'gpt-4o') {
      response = await callOpenAI(message, messages);
    } else if (model === 'custom' && endpoint) {
      response = await callCustomEndpoint(message, messages, endpoint);
    } else {
      // Default to Gemini
      response = await callGemini(message, messages);
    }

    return NextResponse.json({ response });
  } catch (error) {
    console.error('[v0] Chat API error:', error);
    return NextResponse.json(
      { error: 'Failed to process chat request' },
      { status: 500 }
    );
  }
}

async function callGemini(
  message: string,
  messages: Array<{ role: string; content: string }>
): Promise<string> {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error('GOOGLE_API_KEY not configured');
  }

  const conversationHistory = messages.map((msg) => ({
    role: msg.role === 'user' ? 'user' : 'model',
    parts: [{ text: msg.content }],
  }));

  conversationHistory.push({
    role: 'user',
    parts: [{ text: message }],
  });

  const response = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: conversationHistory,
        generationConfig: {
          temperature: 0.9,
          maxOutputTokens: 1024,
        },
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.statusText}`);
  }

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response generated';
}

async function callOpenAI(
  message: string,
  messages: Array<{ role: string; content: string }>
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY not configured');
  }

  const conversationHistory = messages.map((msg) => ({
    role: msg.role,
    content: msg.content,
  }));

  conversationHistory.push({
    role: 'user',
    content: message,
  });

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: conversationHistory,
      temperature: 0.9,
      max_tokens: 1024,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.statusText}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || 'No response generated';
}

async function callCustomEndpoint(
  message: string,
  messages: Array<{ role: string; content: string }>,
  endpoint: string
): Promise<string> {
  const conversationHistory = messages.map((msg) => ({
    role: msg.role,
    content: msg.content,
  }));

  conversationHistory.push({
    role: 'user',
    content: message,
  });

  const response = await fetch(`${endpoint}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messages: conversationHistory,
      temperature: 0.9,
      max_tokens: 1024,
    }),
  });

  if (!response.ok) {
    throw new Error(`Custom endpoint error: ${response.statusText}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || 'No response generated';
}
