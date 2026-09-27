import { createAssistantMessageEventStream } from '/home/chris/.bun/install/global/node_modules/@oh-my-pi/pi-ai/src/utils/event-stream.ts';

export default function(api) {
  let turn = 0;
  api.registerProvider('tab-fixture', {
    baseUrl: 'http://127.0.0.1:1', apiKey: 'offline-unused', api: 'tab-fixture',
    models: [{ id: 'local', name: 'Offline tab image fixture', reasoning: false, input: ['text','image'], cost: {input:0,output:0,cacheRead:0,cacheWrite:0}, contextWindow: 200000, maxTokens: 1000 }],
    streamSimple(model, context) {
      const stream = createAssistantMessageEventStream();
      const toolUse = context.messages.filter(message => message.role === 'user' || message.role === 'toolResult').at(-1)?.role === 'user';
      const content = toolUse ? Array.from({length:40}, (_, i) => i + 1).map(index => ({type:'toolCall', id:`fixture-${++turn}-${index}`, name:'read', arguments:{path:`/tmp/stress40/img_${String(index).padStart(2,'0')}.png`}})) : [{type:'text', text:`Fixture complete; OMP pid=${process.pid}; kitty; no provider network.`}];
      const message = {role:'assistant',content:[],api:model.api,provider:model.provider,model:model.id,usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:toolUse?'toolUse':'stop',timestamp:Date.now()};
      stream.push({type:'start',partial:message});
      for (const block of content) {
        const contentIndex = message.content.length;
        message.content.push(block);
        if (block.type === 'toolCall') {
          stream.push({type:'toolcall_start',contentIndex,partial:message});
          stream.push({type:'toolcall_delta',contentIndex,delta:JSON.stringify(block.arguments),partial:message});
          stream.push({type:'toolcall_end',contentIndex,toolCall:block,partial:message});
        } else {
          stream.push({type:'text_start',contentIndex,partial:message});
          stream.push({type:'text_delta',contentIndex,delta:block.text,partial:message});
          stream.push({type:'text_end',contentIndex,content:block.text,partial:message});
        }
      }
      stream.push({type:'done',reason:message.stopReason,message});
      stream.end();
      return stream;
    }
  });
}
