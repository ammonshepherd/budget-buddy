import { readFile, appendFile } from "node:fs/promises";
// Include a brief actionable result in the artifact name as well as the normal
// job summary, so readers can identify failures before downloading the report.
const report = JSON.parse(await readFile("test-results/results.json", "utf8"));
const failures=[];
function walk(suite) {
  for(const spec of suite.specs || [])for(const test of spec.tests || []) {
    const result=test.results.at(-1);
    if(result?.status!=="passed" && result?.status!=="skipped")failures.push({title:spec.title,project:test.projectName,error:JSON.stringify(result.errors?.length ? result.errors : [result.error])});
  }
  for(const child of suite.suites || [])walk(child);
}
report.suites.forEach(walk);
const clean=(text)=>text.replace(/\u001b\[[0-9;]*m/g,"").replace(/[<>:"/\\|?*\r\n]/g," ").replace(/\s+/g," ").trim();
const result=failures.length?`${failures.length}-failed-${clean(failures[0].error).slice(0,170)}`:`${report.stats.expected}-passed`;
if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,`result=${result}\n`);
if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,`Browser checks: ${report.stats.expected} passed, ${failures.length} failed.\n\n${failures.map(f=>`${f.project} / ${f.title}\n\n${f.error}`).join("\n\n")}\n`);
console.log(JSON.stringify({stats:report.stats,failures}));
