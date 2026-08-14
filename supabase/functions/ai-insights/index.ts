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

    // Load portfolio
    const [assets, liabilities, snapshots, goals] = await Promise.all([
      supabase.from('assets').select('*').eq('user_id', user.id),
      supabase.from('liabilities').select('*').eq('user_id', user.id),
      supabase.from('net_worth_snapshots').select('*').eq('user_id', user.id)
        .order('date', { ascending: false }).limit(90),
      supabase.from('goals').select('*').eq('user_id', user.id)
    ]);

    const portfolioSummary = {
      assets: (assets.data || []).map(a => ({ type: a.type, label: a.label, data: a.data })),
      liabilities: (liabilities.data || []).map(l => ({ type: l.type, label: l.label, rate: l.rate, principal: l.principal })),
      snapshots: (snapshots.data || []).slice(0, 30),
      goals: goals.data || []
    };

    const prompt = `Analyze this portfolio and generate exactly 5 personalized financial insights.

PORTFOLIO DATA:
${JSON.stringify(portfolioSummary)}

RULES FOR INSIGHTS:
1. Each insight must reference SPECIFIC holdings by name and amount
2. Prioritize actionable advice over observations
3. Consider Indian tax laws (LTCG 12.5% above ₹1.25L, STCG 20%, 80C ₹1.5L limit, 80CCD ₹50K NPS)
4. Consider current market conditions and interest rate environment
5. Flag any concentration risk, liquidity mismatch, or goal misalignment
6. Include at least one positive insight (what's going well)
7. Include at least one forward-looking projection insight

FORMAT each insight as JSON:
{
  "title": "Short headline (under 60 chars)",
  "body": "2-3 sentence explanation with specific numbers",
  "severity": "high|medium|info|positive",
  "category": "risk|opportunity|tax|goal|allocation|debt",
  "actionable": true/false,
  "action": "Specific next step (if actionable)"
}

Return ONLY a JSON array of exactly 5 insights, sorted by severity (high first). No other text.`;

    const geminiRes = await fetch(`${GEMINI_URL}?key=${GEMINI_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 2048, temperature: 0.4 }
      })
    });

    if (!geminiRes.ok) throw new Error(`Gemini error: ${geminiRes.status}`);

    const geminiData = await geminiRes.json();
    let responseText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '[]';

    // Extract JSON array from response (handle markdown code blocks)
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    const insights = jsonMatch ? JSON.parse(jsonMatch[0]) : [];

    // Cache results
    const hash = simpleHash(JSON.stringify(portfolioSummary.assets));
    await supabase.from('cached_insights').upsert({
      user_id: user.id,
      insights,
      generated_at: new Date().toISOString(),
      portfolio_hash: hash
    });

    return new Response(JSON.stringify({ insights }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || 'Internal error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const chr = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return hash.toString(36);
}
