-- ============================================================
-- WealthForge AI — demo account seed
-- Run AFTER supabase/migrations/0001_init.sql, in the SQL editor.
-- Creates demo@wealthforge.ai (password: wealthforge-demo) with the
-- sample portfolio the app has shipped with, ~12 months of net-worth
-- snapshots, and two example goals. The password is public by design:
-- RLS makes every demo row read-only (see is_demo_user()).
-- ============================================================

do $$
declare
  demo_id uuid := '11111111-1111-4111-8111-111111111111';
  re_id   uuid := '22222222-2222-4222-8222-222222222222';
begin
  -- ---------- auth user (idempotent) ----------
  -- the empty-string token columns matter: GoTrue fails password logins
  -- with "Database error querying schema" when they are NULL
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token
  ) values (
    demo_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'demo@wealthforge.ai', crypt('wealthforge-demo', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', '{"display_name":"Demo Investor"}',
    now(), now(),
    '', '', '', '', '', '', '', ''
  ) on conflict (id) do nothing;

  insert into auth.identities (
    id, user_id, provider_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at
  )
  select gen_random_uuid(), demo_id, demo_id::text,
         jsonb_build_object('sub', demo_id::text, 'email', 'demo@wealthforge.ai', 'email_verified', true),
         'email', now(), now(), now()
  where not exists (select 1 from auth.identities where user_id = demo_id and provider = 'email');

  -- profile row is auto-created by the signup trigger
  update public.profiles
     set is_demo = true, display_name = 'Demo Investor'
   where id = demo_id;

  -- ---------- portfolio (ported from the in-app sample data) ----------
  delete from public.assets where user_id = demo_id;
  insert into public.assets (user_id, name, category, value, quantity, valuation_mode, metadata) values
  (demo_id, 'Reliance core holding', 'equity', 120500, 40, 'live', '{
    "label":"Reliance core holding","type":"equity","acquiredOn":"2021-06-14","ownership":"single","sharePct":100,"currency":"INR",
    "data":{"symbol":"RELIANCE","quantity":40,"avgPrice":2210,"lots":[{"date":"2021-06-14","qty":25,"price":2105},{"date":"2022-11-02","qty":15,"price":2385}]}}'),
  (demo_id, 'TCS', 'equity', 50260, 12, 'live', '{
    "label":"TCS","type":"equity","acquiredOn":"2023-02-20","ownership":"single","sharePct":100,"currency":"INR",
    "data":{"symbol":"TCS","quantity":12,"avgPrice":3390}}'),
  (demo_id, 'Flexi cap SIP', 'mf', 479300, 5200, 'live', '{
    "label":"Flexi cap SIP","type":"mf","acquiredOn":"2020-04-10","ownership":"single","sharePct":100,"currency":"INR",
    "data":{"schemeCode":"122639","plan":"Direct","option":"Growth","units":5200,"avgNav":48.6,"sipOngoing":true,"sipAmount":15000,"sipFreq":"monthly",
      "lots":[{"date":"2020-04-10","qty":1800,"price":30.1},{"date":"2021-04-10","qty":1400,"price":44.9},{"date":"2022-04-10","qty":1100,"price":52.3},{"date":"2023-04-10","qty":900,"price":61.8}]}}'),
  (demo_id, 'Emergency corpus', 'mf', 299400, 9300, 'live', '{
    "label":"Emergency corpus","type":"mf","acquiredOn":"2023-08-01","ownership":"single","sharePct":100,"currency":"INR",
    "data":{"schemeCode":"119523","plan":"Direct","option":"Growth","units":9300,"avgNav":28.4}}'),
  (demo_id, 'Microsoft RSU grant', 'esop', 3900000, 160, 'live', '{
    "label":"Microsoft RSU grant","type":"esop","acquiredOn":"2023-07-01","ownership":"single","sharePct":100,"currency":"USD",
    "data":{"company":"Microsoft","ticker":"MSFT","grantType":"RSU","totalUnits":160,"vestStart":"2023-07-01","cliffMonths":12,"freq":"quarterly","durationMonths":48,"currency":"USD"}}'),
  (demo_id, 'HDFC 5-yr FD', 'fd', 640000, null, 'computed', '{
    "label":"HDFC 5-yr FD","type":"fd","acquiredOn":"2023-01-15","ownership":"single","sharePct":100,"currency":"INR",
    "data":{"principal":500000,"rate":7.1,"startDate":"2023-01-15","tenureYears":5,"compounding":"quarterly","interestType":"cumulative","bank":"HDFC Bank","institutionType":"bank","autoRenew":"principal_interest","tds":true,"status":"active"}}'),
  (demo_id, 'NSC 2024', 'smallsavings', 120000, null, 'computed', '{
    "label":"NSC 2024","type":"smallsavings","acquiredOn":"2024-02-10","ownership":"single","sharePct":100,"currency":"INR",
    "data":{"subType":"nsc","principal":100000,"rate":7.7,"tenureYears":5,"startDate":"2024-02-10"}}'),
  (demo_id, 'EPF (Infosys UAN)', 'epf', 900000, null, 'computed', '{
    "label":"EPF (Infosys UAN)","type":"epf","acquiredOn":"2017-08-01","ownership":"single","sharePct":100,"currency":"INR",
    "data":{"balance":865000,"asOfDate":"2026-03-31","empContribution":9000,"erContribution":5500,"vpf":0,"rate":8.25,"currentAge":32,"retirementAge":60,"uan":"1012 3456 7890"}}'),
  (demo_id, 'PPF (SBI)', 'ppf', 1270000, null, 'computed', '{
    "label":"PPF (SBI)","type":"ppf","acquiredOn":"2016-04-01","ownership":"single","sharePct":100,"currency":"INR",
    "data":{"balance":1240000,"asOfDate":"2026-03-31","annualContribution":150000,"rate":7.1,"openDate":"2016-04-01","extensionYears":0}}'),
  (demo_id, 'NPS Tier I', 'nps', 630000, null, 'live', '{
    "label":"NPS Tier I","type":"nps","acquiredOn":"2020-01-15","ownership":"single","sharePct":100,"currency":"INR",
    "data":{"corpus":620000,"asOfDate":"2026-06-30","monthlyContribution":10000,"tier":"I","allocE":50,"allocC":30,"allocG":20}}'),
  (demo_id, 'Wedding jewellery', 'gold', 610000, 85, 'live', '{
    "label":"Wedding jewellery","type":"gold","acquiredOn":"2019-11-22","ownership":"single","sharePct":100,"currency":"INR",
    "data":{"metal":"gold","form":"physical","grams":85,"purity":"22K","buyRate":3900,"totalPaid":361500,"makingCharges":30000}}'),
  (demo_id, 'SGB 2019-20 S4', 'gold', 235500, 30, 'live', '{
    "label":"SGB 2019-20 S4","type":"gold","acquiredOn":"2019-09-17","ownership":"single","sharePct":100,"currency":"INR",
    "data":{"metal":"gold","form":"sgb","instrumentId":"SGB2027","units":30,"buyPrice":3890,"sgbRate":2.5,"sgbMaturity":"2027-09-17"}}'),
  (demo_id, 'BTC stack', 'crypto', 1865000, 0.18, 'live', '{
    "label":"BTC stack","type":"crypto","acquiredOn":"2021-02-01","ownership":"single","sharePct":100,"currency":"USD",
    "data":{"coinId":"BTC","quantity":0.18,"avgPrice":41200,"investCurrency":"USD",
      "lots":[{"date":"2021-02-01","qty":0.10,"price":33500},{"date":"2022-06-20","qty":0.05,"price":20100},{"date":"2024-01-12","qty":0.03,"price":46800}]}}'),
  (demo_id, 'ETH', 'crypto', 522000, 1.4, 'live', '{
    "label":"ETH","type":"crypto","acquiredOn":"2022-09-10","ownership":"single","sharePct":100,"currency":"USD",
    "data":{"coinId":"ETH","quantity":1.4,"avgPrice":1720,"investCurrency":"USD"}}'),
  (demo_id, 'Honda City', 'other', 890000, null, 'manual', '{
    "label":"Honda City","type":"other","acquiredOn":"2022-10-12","ownership":"single","sharePct":100,"currency":"INR",
    "data":{"subPattern":"depreciating","subType":"Vehicle","costBasis":1450000,"growthRate":-12,"valuationMethod":"rate"}}');

  -- the property gets a fixed id so the home loan can link to it
  insert into public.assets (id, user_id, name, category, value, quantity, valuation_mode, metadata) values
  (re_id, demo_id, '2BHK, Whitefield', 'realestate', 5250000, null, 'manual', '{
    "label":"2BHK, Whitefield","type":"realestate","acquiredOn":"2018-07-30","ownership":"joint","sharePct":50,"currency":"INR",
    "data":{"propertyType":"residential","city":"Bengaluru","locality":"Whitefield","purchasePrice":6800000,"acquisitionCosts":450000,"currentValue":10500000,"lastRevaluedOn":"2026-03-01","appreciationRate":6.5,"rentPerMonth":32000,"sqft":1150,"ratePerSqft":9130}}')
  on conflict (id) do update set user_id = excluded.user_id, metadata = excluded.metadata;

  -- ---------- liabilities ----------
  delete from public.liabilities where user_id = demo_id;
  insert into public.liabilities (user_id, name, type, balance, interest_rate, metadata) values
  (demo_id, 'HDFC home loan', 'homeloan', 1350000, 8.6, ('{
    "label":"HDFC home loan","type":"homeloan","lender":"HDFC Bank","principal":2400000,"asOfDate":"2026-06-30","rate":8.6,"emi":42000,"startDate":"2018-08-01","linkedAssetId":"' || re_id || '"}')::jsonb),
  (demo_id, 'Car loan (Honda City)', 'carloan', 300000, 9.4, '{
    "label":"Car loan (Honda City)","type":"carloan","lender":"ICICI Bank","principal":420000,"asOfDate":"2026-06-30","rate":9.4,"emi":13500,"startDate":"2022-10-12"}'),
  (demo_id, 'Amex card outstanding', 'creditcard', 85000, 42, '{
    "label":"Amex card outstanding","type":"creditcard","lender":"American Express","principal":85000,"asOfDate":"2026-07-15","rate":42,"emi":null,"startDate":"2026-07-15"}');

  -- ---------- ~12 months of weekly net-worth snapshots ----------
  delete from public.net_worth_snapshots where user_id = demo_id;
  insert into public.net_worth_snapshots (user_id, snapshot_date, total_assets, total_liabilities, net_worth)
  select
    demo_id,
    (current_date - (52 - i) * 7),
    round(14400000 + 2600000 * i / 52.0 + 180000 * sin(i / 3.0)) + round(1660000 - i * 8300),
    round(1660000 - i * 8300),
    round(14400000 + 2600000 * i / 52.0 + 180000 * sin(i / 3.0))
  from generate_series(0, 52) as i;

  -- ---------- goals ----------
  delete from public.goals where user_id = demo_id;
  insert into public.goals (user_id, title, target_amount, target_date, achieved, achieved_at) values
  (demo_id, 'First ₹1.5 Cr net worth', 15000000, null, true, now() - interval '4 months'),
  (demo_id, '₹2.5 Cr by 2030', 25000000, '2030-12-31', false, null);
end $$;
