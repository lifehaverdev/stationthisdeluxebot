const { sendEscapedMessage, editEscapedMessageText } = require('../utils/messaging');
const { escapeMarkdownV2 } = require('../../../utils/stringUtils');

// Helper to fetch api client from dependencies
function getApiClient(deps) {
  return deps.internalApiClient || deps.internal?.client;
}

const ITEMS_PER_PAGE_ALL_TOOLS = 6; // 3 rows of 2 tools

/**
 * Fetches most frequently used tools for a user via internal API.
 */
async function getMostFrequentlyUsedTools(masterAccountId, deps) {
  const { logger } = deps;
  try {
    const client = getApiClient(deps);
    if (!client) throw new Error('internalApiClient missing');
    const res = await client.get(`/internal/v1/data/generations/users/${masterAccountId}/most-frequent-tools`, { params: { limit: 12 } });
    return (res.data?.frequentTools || []).slice(0, 5);
  } catch (err) {
    deps.logger?.error('[ToolsMenu] frequent tools error', err.message);
    return [];
  }
}

function formatParamNameForDisplay(name) {
  if (!name) return '';
  return name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ---------- Menu builders ----------
async function buildMainMenu(masterAccountId, deps) {
  const { toolRegistry } = deps;
  const text = '\nBrowse available tools.';
  const keyboard = [];
  keyboard.push([{ text: 'All Tools', callback_data: 'tool_all_0' }]);

  const frequent = await getMostFrequentlyUsedTools(masterAccountId, deps);
  for (let i = 0; i < frequent.length; i += 2) {
    const row = [];
    const tool1 = toolRegistry.getToolById(frequent[i].toolId);
    if (tool1) {
      row.push({ text: tool1.displayName, callback_data: `tool_view_${tool1.displayName.replace(/\s+/g, '_')}` });
    }
    if (i + 1 < frequent.length) {
      const tool2 = toolRegistry.getToolById(frequent[i + 1].toolId);
      if (tool2) {
        row.push({ text: tool2.displayName, callback_data: `tool_view_${tool2.displayName.replace(/\s+/g, '_')}` });
      }
    }
    if (row.length) keyboard.push(row);
  }

  keyboard.push([{ text: 'Ⓧ', callback_data: 'tool_nvm' }]);
  return { text, reply_markup: { inline_keyboard: keyboard } };
}

async function buildAllToolsMenu(masterAccountId, page, deps) {
  const { toolRegistry } = deps;
  const allTools = toolRegistry.getAllTools().filter(t => !t.displayName.includes('_API') && !t.displayName.includes('_COOK')).sort((a,b)=>a.displayName.localeCompare(b.displayName));
  const total = allTools.length;
  const pages = Math.ceil(total / ITEMS_PER_PAGE_ALL_TOOLS);
  const current = Math.max(0, Math.min(page, pages-1));

  const text = `All Tools (page ${current+1}/${pages})`;
  const keyboard = [];
  keyboard.push([{ text: '⇱', callback_data: 'tool_main' }]);

  const slice = allTools.slice(current*ITEMS_PER_PAGE_ALL_TOOLS, current*ITEMS_PER_PAGE_ALL_TOOLS+ITEMS_PER_PAGE_ALL_TOOLS);
  for (let i=0;i<slice.length;i+=2){
    const row=[];
    const t1=slice[i];
    row.push({ text: t1.displayName, callback_data:`tool_view_${t1.displayName.replace(/\s+/g,'_')}` });
    if(i+1<slice.length){
      const t2=slice[i+1];
      row.push({ text: t2.displayName, callback_data:`tool_view_${t2.displayName.replace(/\s+/g,'_')}` });
    }
    keyboard.push(row);
  }

  const nav=[];
  if(current>0) nav.push({ text:'⇤', callback_data:`tool_all_${current-1}` });
  if(pages>1) nav.push({ text:`${current+1}/${pages}`, callback_data:'noop' });
  if(current<pages-1) nav.push({ text:'⇥', callback_data:`tool_all_${current+1}` });
  if(nav.length) keyboard.push(nav);
  keyboard.push([{ text:'Ⓧ', callback_data:'tool_nvm' }]);

  return { text, reply_markup:{ inline_keyboard: keyboard } };
}

async function buildToolDetailMenu(displayName, deps){
  const { toolRegistry } = deps;
  const tool = toolRegistry.findByDisplayName(displayName);
  if(!tool){
    return { text:'Tool not found', reply_markup:{ inline_keyboard:[[{ text:'⇱', callback_data:'tool_main' }]] } };
  }
  const esc = escapeMarkdownV2;
  const text = `*${esc(tool.displayName)}*\n\n${esc(tool.description||'No description.')}\n`;
  const keyboard=[[{ text:'⇱', callback_data:'tool_main' }, { text:'Ⓧ', callback_data:'tool_nvm' }]];
  return { text, reply_markup:{ inline_keyboard: keyboard } };
}

// ---------- Handlers ----------
async function handleToolsCommand(bot, msg, deps){
  const api = deps.internal.client;
  const res = await api.post('/internal/v1/data/users/find-or-create',{ platform:'telegram', platformId: msg.from.id.toString(), platformContext:{ firstName: msg.from.first_name, username: msg.from.username }});
  const maid = res.data.masterAccountId;
  const menu = await buildMainMenu(maid, deps);
  await sendEscapedMessage(bot, msg.chat.id, menu.text, { reply_markup: menu.reply_markup, reply_to_message_id: msg.message_id });
}

async function handleToolsCallback(bot, query, masterAccountId, deps){
  const data = query.data;
  let menu;
  if(data==='tool_nvm'){
    await bot.deleteMessage(query.message.chat.id, query.message.message_id);
    await bot.answerCallbackQuery(query.id, { text:'Closed.' });
    return;
  }
  if(data==='tool_main'){
    menu = await buildMainMenu(masterAccountId, deps);
  } else if(data.startsWith('tool_all_')){
    const page = parseInt(data.substring('tool_all_'.length),10)||0;
    menu = await buildAllToolsMenu(masterAccountId, page, deps);
  } else if(data.startsWith('tool_view_')){
    const name = data.substring('tool_view_'.length).replace(/_/g,' ');
    menu = await buildToolDetailMenu(name, deps);
  } else {
    await bot.answerCallbackQuery(query.id);
    return;
  }

  await editEscapedMessageText(bot, menu.text, { chat_id: query.message.chat.id, message_id: query.message.message_id, reply_markup: menu.reply_markup });
  await bot.answerCallbackQuery(query.id);
}

function registerHandlers(dispatchers, deps){
  const { commandDispatcher, callbackQueryDispatcher } = dispatchers;
  commandDispatcher.register(/^\/tools(?:@\w+)?/i, (bot,msg)=> handleToolsCommand(bot,msg,deps));
  callbackQueryDispatcher.register('tool_', (bot,query,maid)=> handleToolsCallback(bot,query,maid,deps));
}

module.exports = { registerHandlers };
