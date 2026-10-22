/* Session-scoped reads. Never fall back to anonymous table access. */
'use strict';
window.secureRead = function(table) {
  const state = { filters:[], order:'id', ascending:true, offset:0, limit:1000, single:false };
  const query = {
    select() { return this; },
    eq(column,value) { state.filters.push({column,op:'eq',value}); return this; },
    in(column,value) { state.filters.push({column,op:'in',value}); return this; },
    is(column,value) { state.filters.push({column,op:'is',value}); return this; },
    order(column,options={}) { state.order=column; state.ascending=options.ascending!==false; return this; },
    limit(value) { state.limit=value; return this; },
    range(start,end) { state.offset=start; state.limit=end-start+1; return this; },
    maybeSingle() { state.single=true; state.limit=2; return this; },
    async execute() {
      const token=window.getSessionToken && window.getSessionToken();
      if (!token) return {data:null,error:{message:'انتهت الجلسة'},status:401};
      const response=await window.sb.rpc('read_scoped_data', {
        p_token:token,p_table:table,p_filters:state.filters,p_order:state.order,
        p_ascending:state.ascending,p_offset:state.offset,p_limit:state.limit
      });
      if (response.error) return response;
      const rows=response.data;
      if (!Array.isArray(rows)) return {data:null,error:{message:'استجابة قراءة غير مكتملة'},status:500};
      if (state.single && rows.length>1) return {data:null,error:{message:'Expected at most one row'},status:406};
      return {data:state.single?(rows[0]||null):rows,error:null,status:200};
    },
    then(resolve,reject) { return this.execute().then(resolve,reject); }
  };
  return query;
};
