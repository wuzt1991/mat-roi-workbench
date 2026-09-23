const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const M=require('../public/domain.js');

// Run the real UI handlers against an isolated in-memory workspace, without booting persistence.
function appHarness(initial=M.initialState(),options={}){
  const listeners={},elements=new Map();
  const element=()=>({innerHTML:'',textContent:'',value:'',dataset:{},isConnected:true,
    classList:{add(){},remove(){}},addEventListener(){},querySelector(){return null;},querySelectorAll(){return [];},
    focus(){document.activeElement=this;},setAttribute(){},removeAttribute(){},
    showModal(){this.open=true;},close(){this.open=false;}});
  const document={activeElement:null,querySelector(selector){if(!elements.has(selector))elements.set(selector,element());return elements.get(selector);},
    querySelectorAll(){return [];},addEventListener(type,callback){(listeners[type]??=[]).push(callback);}};
  const window={OperatingEntryViews:require('../public/operating-records/entry-views.js'),WorkbenchFormat:require('../public/ui-format.js'),RulesViews:require('../public/rules-views.js'),ShellViews:require('../public/shell-views.js'),OperatingEntries:require('../public/operating-records/entries.js'),OperatingController:require('../public/operating-records/controller.js'),SalesImportModel:require('../public/sales-import/model.js'),WorkbenchShell:require('../public/workbench-shell.js'),RulesEditor:require('../public/rules-editor.js'),OperatingRecords:require('../public/operating-records.js'),MatModel:M,MatWorkbook:require('../public/workbook.js'),MatTransfer:require('../public/transfer.js'),MatTrends:require('../public/trends.js'),MatProductTransfer:require('../public/product-transfer.js'),ReusableRules:require('../public/reusable-rules.js'),PricingRules:require('../public/pricing-rules.js'),SalesImport:require('../public/sales-import.js'),PromotionRules:require('../public/promotion-rules.js'),addEventListener(){},confirm:()=>false,...options};
  const source=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8').replace(/  initialize\(\);\r?\n\}\)\(\);/,`  window.testApp={set booted(v){booted=v;},get state(){return state;},set state(v){state=v;},get modal(){return modal;},set modal(v){modal=v;},set queue(v){queue=v;},transferRules,startEntry,modalValue,saveModal,open,close,render,paintModal,skuTable,commonSizeChoices,skuOptions,listingCalculator,reusableForm,skuDisplayForm,productTransferPage,updateAction,updateStatusText,handleUpdateStatus};\n})();`);
  const context=vm.createContext({window,document,console,structuredClone,crypto:require('node:crypto').webcrypto,sessionStorage:{getItem(){return 'test';},setItem(){}},setTimeout(){return 1;},clearTimeout(){},fetch(){throw Error('Tests must not contact the database');}});
  vm.runInContext(source,context);window.testApp.state=initial;window.testApp.booted=true;
  return {ui:window.testApp,document,elements,window,async dispatch(type,target){for(const callback of listeners[type]||[])await callback({target,preventDefault(){}});}};
}
module.exports={appHarness};
