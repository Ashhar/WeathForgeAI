import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GEMINI_KEY = Deno.env.get('GEMINI_API_KEY');
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return new Response('Unauthorized', { status: 401, headers: corsHeaders });

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: { user } } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    if (!user) return new Response('Unauthorized', { status: 401, headers: corsHeaders });

    // Rate limiting: 20 messages per day for free tier
    const today = new Date().toISOString().slice(0, 10);
    const { count } = await supabase
      .from('chat_messages')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('role', 'user')
      .gte('created_at', today + 'T00:00:00Z');

    if ((count || 0) >= 20) {
      return new Response(JSON.stringify({ error: 'Daily limit reached (20 questions/day)' }), {
        status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const { question, history } = await req.json();
    if (!question) return new Response(JSON.stringify({ error: 'No question provided' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

    // Load user's portfolio data
    const [assets, liabilities, snapshots, goals] = await Promise.all([
      supabase.from('assets').select('*').eq('user_id', user.id),
      supabase.from('liabilities').select('*').eq('user_id', user.id),
      supabase.from('net_worth_snapshots').select('*').eq('user_id', user.id)
        .order('date', { ascending: false }).limit(90),
      supabase.from('goals').select('*').eq('user_id', user.id)
    ]);

    const systemPrompt = buildSystemPrompt(
      assets.data || [], liabilities.data || [],
      snapshots.data || [], goals.data || []
    );

    // Call Gemini
    const geminiRes = await fetch(`${GEMINI_URL}?key=${GEMINI_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          { role: 'user', parts: [{ text: systemPrompt }] },
          ...(history || []).map((m: any) => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }]
          })),
          { role: 'user', parts: [{ text: question }] }
        ],
        generationConfig: { maxOutputTokens: 1024, temperature: 0.7 }
      })
    });

    if (!geminiRes.ok) {
      const err = await geminiRes.text();
      throw new Error(`Gemini API error: ${geminiRes.status} ${err}`);
    }

    const geminiData = await geminiRes.json();
    const response = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || 'Sorry, I could not generate a response.';

    // Persist messages
    await supabase.from('chat_messages').insert([
      { user_id: user.id, role: 'user', content: question },
      { user_id: user.id, role: 'assistant', content: response }
    ]);

    return new Response(JSON.stringify({ response }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || 'Internal error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

function buildSystemPrompt(assets: any[], liabilities: any[], snapshots: any[], goals: any[]) {
  const totalAssets = assets.reduce((s, a) => s + (a.data?.currentValue || a.data?.principal || 0), 0);
  const totalLiab = liabilities.reduce((s, l) => s + (l.outstanding || l.principal || 0), 0);
  const netWorth = totalAssets - totalLiab;

  const allocation: Record<string, number> = {};
  for (const a of assets) {
    const val = a.data?.currentValue || a.data?.principal || 0;
    allocation[a.type] = (allocation[a.type] || 0) + val;
  }

  const holdingsList = assets.slice(0, 30).map(a =>
    `- ${a.label || a.type}: ₹${formatIndian(a.data?.currentValue || a.data?.principal || 0)} (${a.type})`
  ).join('\n');

  const liabList = liabilities.map(l =>
    `- ${l.label || l.type}: ₹${formatIndian(l.outstanding || l.principal || 0)} @ ${l.rate}%`
  ).join('\n');

  const trend = snapshots.slice(0, 30).map(s => `${s.date}: ₹${formatIndian(s.net_worth)}`).join(', ');

  const goalsList = goals.map(g => `- ${g.label}: target ₹${formatIndian(g.target)}`).join('\n');

  return `You are WealthForge AI Assistant, a personal financial advisor analyzing the user's portfolio.

IMPORTANT RULES:
- Always use Indian currency formatting (₹, lakhs, crores)
- Be specific — reference actual holdings by name and value
- When recommending actions, explain the tax implications (Indian tax law)
- Never recommend specific stocks/MFs by name — suggest categories/approaches
- If asked about something outside finance, politely redirect
- Keep responses concise (under 200 words unless asked for detail)
- Use markdown bold for emphasis

USER'S PORTFOLIO:
- Total Assets: ₹${formatIndian(totalAssets)}
- Total Liabilities: ₹${formatIndian(totalLiab)}
- Net Worth: ₹${formatIndian(netWorth)}

ALLOCATION:
${Object.entries(allocation).map(([k, v]) => `- ${k}: ₹${formatIndian(v)} (${((v / totalAssets) * 100).toFixed(1)}%)`).join('\n')}

HOLDINGS (top 30):
${holdingsList || 'No holdings'}

LIABILITIES:
${liabList || 'None'}

RECENT TREND (last 30 days):
${trend || 'No snapshots'}

GOALS:
${goalsList || 'No goals set'}

Answer the user's question based on this data. Be specific and actionable.`;
}

function formatIndian(n: number): string {
  if (!n || !isFinite(n)) return '0';
  const abs = Math.abs(n);
  if (abs >= 1e7) return (n / 1e7).toFixed(2) + ' Cr';
  if (abs >= 1e5) return (n / 1e5).toFixed(2) + ' L';
  if (abs >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toFixed(0);
}
