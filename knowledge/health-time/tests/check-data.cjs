const fs=require('fs'),vm=require('vm');
const context={window:{},console};
vm.runInNewContext(fs.readFileSync(__dirname+'/../data/health-data.js','utf8'),context);
const data=context.window.HealthKnowledgeData;
if(data.exercise.length!==50)throw Error(`exercise count ${data.exercise.length}`);
if(data.rest.length!==56)throw Error(`sleep/rest count ${data.rest.length}`);
if(data.exerciseLaws.length!==15||data.sleepLaws.length!==15)throw Error('principle count mismatch');
if(data.cautions.length!==30)throw Error('caution count mismatch');
for(const [name,rows] of [['exercise',data.exercise],['rest',data.rest]]){
 const ids=new Set();
 for(const x of rows){if(!x.id||!x.name||!x.equation||!x.method||!x.evidence||!x.category)throw Error(`${name} incomplete row`);if(ids.has(x.id))throw Error(`${name} duplicate id`);ids.add(x.id)}
}
if(data.sources.length<15)throw Error('too few sources');
console.log(`OK: ${data.exercise.length} exercise, ${data.rest.length} sleep/rest, ${data.sources.length} sources, ${data.cautions.length} cautions`);
