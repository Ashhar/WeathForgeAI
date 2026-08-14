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

    const { input } = await req.json();
    if (!input) return new Response(JSON.stringify({ error: 'No input provided' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

    const prompt = `Parse this natural language input into a structured financial asset or liability.

INPUT: "${input}"

Determine the type and extract all fields. Return ONLY valid JSON (no markdown):
{
  "type": "equity|mf|crypto|fd|epf|ppf|nps|gold|realestate|esop|other|homeloan|carloan|personal|education|creditcard",
  "isLiability": false,
  "label": "Human-readable name",
  "data": {
    // Include ALL fields that can be inferred from the input:
    // equity: { ticker, exchange, quantity, avgCost, purchaseDate }
    // mf: { schemeName, units, avgNav, sipAmount, startDate }
    // fd: { bank, principal, rate, tenureMonths, startDate, compounding }
    // ppf: { balance, annualContribution }
    // epf: { balance, monthlyContribution, rate }
    // gold: { form, grams, purchasePrice, purchaseDate }
    // crypto: { coin, quantity, avgCost, purchaseDate }
    // realestate: { propertyType, purchasePrice, currentValue, area, areaUnit }
    // homeloan: { lender, principal, rate, tenureMonths, emi, startDate }
    // carloan/personal/education: { lender, principal, rate, tenureMonths, emi, startDate }
  },
  "confidence": "high|medium|low",
  "ambiguities": ["list of things that couldn't be determined from input"]
}

RULES:
- If the input uses Indian shorthand: L/Lakh = 100000, Cr/Crore = 10000000, K/Thousand = 1000
- Convert all amounts to full numbers (e.g., "5L" → 500000)
- For dates, use ISO format YYYY-MM-DD. If only month/year given, use 1st of that month.
- If no date given, use today's date
- If exchange not specified for equity, assume "NSE"
- If compounding not specified for FD, assume "quarterly"
- For MF SIP, extract monthly amount and start date
- Be generous in interpretation — pick the most likely type even if ambiguous`;

    const geminiRes = await fetch(`${GEMINI_URL}?key=${GEMINI_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 1024, temperature: 0.2 }
      })
    });

    if (!geminiRes.ok) throw new Error(`Gemini error: ${geminiRes.status}`);

    const geminiData = await geminiRes.json();
    let responseText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '{}';

    // Extract JSON from response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { error: 'Could not parse' };

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || 'Internal error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
