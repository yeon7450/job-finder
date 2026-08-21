const MAX_JOBS = 300;

function removeContactFields(value) {
  if (Array.isArray(value)) return value.map(removeContactFields);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/(담당|연락|mngr|manager|charger|tel|phone|email|mail|contact)/i.test(key))
    .map(([key, item]) => [key, removeContactFields(item)]));
}

function toFrontendJob(row) {
  return {
    recrutPblntSn: row.recrutpblntsn,
    pblntInstCd: row.pblntinstcd,
    pbadmsStdInstCd: row.pbadmsstdinstcd,
    instNm: row.instnm,
    ncsCdLst: row.ncscdlst,
    ncsCdNmLst: row.ncscdnmlst,
    hireTypeLst: row.hiretypelst,
    hireTypeNmLst: row.hiretypenmlst,
    workRgnLst: row.workrgnlst,
    workRgnNmLst: row.workrgnnmlst,
    recrutSe: row.recrutse,
    recrutSeNm: row.recrutsenm,
    prefCondCn: row.prefcondcn,
    recrutNope: row.recrutnope,
    pbancBgngYmd: row.pbancbgngymd,
    pbancEndYmd: row.pbancendymd,
    recrutPbancTtl: row.recrutpbancttl,
    srcUrl: row.srcurl,
    replmprYn: row.replmpryn,
    aplyQlfcCn: row.aplyqlfccn,
    disqlfcRsn: row.disqlfcrsn,
    scrnprcdrMthdExpln: row.scrnprcdrmthdexpln,
    prefCn: row.prefcn,
    acbgCondLst: row.acbgcondlst,
    acbgCondNmLst: row.acbgcondnmlst,
    nonatchRsn: row.nonatchrsn,
    ongoingYn: row.ongoingyn,
    decimalDay: row.decimalday,
    files: row.files,
    steps: row.steps
  };
}

module.exports = async function handler(request, response) {
  if (request.method !== 'GET') return response.status(405).json({ error: 'Method not allowed' });
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !supabaseKey) return response.status(500).json({ error: 'Supabase environment variables are not configured' });

  try {
    const params = new URLSearchParams({ select: '*', ongoingyn: 'eq.Y', order: 'pbancendymd.asc', limit: String(MAX_JOBS) });
    const apiResponse = await fetch(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/jobs?${params}`, {
      headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` }
    });
    if (!apiResponse.ok) throw new Error(`Supabase returned ${apiResponse.status}`);
    const rows = await apiResponse.json();
    const jobs = rows.map(toFrontendJob).map(removeContactFields);
    response.setHeader('Cache-Control', 'no-store, max-age=0');
    return response.status(200).json({ fetchedAt: new Date().toISOString(), count: jobs.length, jobs });
  } catch (error) {
    console.error(error);
    return response.status(502).json({ error: 'Supabase에서 채용공고를 불러오지 못했습니다.' });
  }
};
