const eq = (field, value) => ({ field, op: 'eq', value });
const table = (id, taskId, goal, args, answer, expected) => ({ id, taskId, goal, tool: 'query_dataset', args, answer, expected, kind: 'table' });

export const SMOKE_CASES = [
  { id: 'notes', taskId: 'study-notes', kind: 'notes', goal: 'Explain HTTP 401 versus 403 using notes. Answer exactly: 401 = <authentication or authorization>; 403 = <authentication or authorization>.',
    tool: 'search_notes', args: { query: '401 403', limit: 3 }, answer: '401 = authentication; 403 = authorization.' },
  table('sum', 'datasets-demo', 'Tính tổng price của sản phẩm category stationery trong products (không nhân stock). Chỉ viết answer theo dạng: stationery = <tổng>.',
    { dataset_id: 'products', operation: 'sum', field: 'price', filters: [eq('category', 'stationery')] }, 'stationery = 30.30.', '30.30'),
  table('compare', 'datasets-demo', 'Compare total students for classes day Mon versus day Tue. Use query_dataset. Answer Mon = <total>; Tue = <total>; Mon <relation> Tue.',
    { dataset_id: 'classes', operation: 'compare', field: 'students', filters: [eq('day', 'Mon')], compare_filters: [eq('day', 'Tue')] }, 'Mon = 55; Tue = 40; Mon > Tue.', ['55', '40']),
  { id: 'missing', taskId: 'study-notes', kind: 'missing', goal: 'Search the notes for the exact room number of the midterm exam. If absent, answer exactly Not in notes. and explain the gap in unresolved. Do not guess.',
    tool: 'search_notes', args: { query: 'phong cu the giua ky', limit: 3 }, answer: 'Not in notes.' },
  ...['approve', 'reject'].map((id) => ({ id, taskId: 'study-notes', kind: 'approval', decision: id === 'approve' ? 'approve' : 'reject',
    goal: 'Summarize HTTP 401 and 403 from the notes and save a draft. After the human decision, answer exactly Saved. if saved or Not saved. if rejected.',
    tool: 'search_notes', args: { query: '401 403', limit: 3 }, answer: id === 'approve' ? 'Saved.' : 'Not saved.' })),
];

export const REHEARSAL_CASES = [
  table('tickets-count', 'rehearsal-tickets', 'Count tickets with team Support and status open. Answer Count = <value>.',
    { dataset_id: 'tickets', operation: 'count', filters: [eq('team', 'Support'), eq('status', 'open')] }, 'Count = 2.', 2),
  table('tickets-compare', 'rehearsal-tickets', 'Compare counts of open tickets in Support versus Billing. Answer Support = <count>; Billing = <count>; Support <relation> Billing.',
    { dataset_id: 'tickets', operation: 'compare', filters: [eq('team', 'Support'), eq('status', 'open')], compare_filters: [eq('team', 'Billing'), eq('status', 'open')] }, 'Support = 2; Billing = 1; Support > Billing.', [2, 1]),
  table('tickets-empty', 'rehearsal-tickets', 'Look up tickets with status cancelled, limit 5. Answer Empty = yes if none match.',
    { dataset_id: 'tickets', operation: 'lookup', filters: [eq('status', 'cancelled')], limit: 5 }, 'Empty = yes.', []),
  { id: 'tickets-blocked', taskId: 'rehearsal-tickets', kind: 'blocked', goal: 'Try reading a dataset outside this task allow-list.', tool: 'query_dataset', args: { dataset_id: 'rooms', operation: 'count' }, answer: 'Blocked.' },
  table('rooms-lookup', 'rehearsal-rooms', 'Find rooms in location South with capacity at least 40, limit 5. Answer Rooms = <room names>.',
    { dataset_id: 'rooms', operation: 'lookup', filters: [eq('location', 'South'), { field: 'capacity', op: 'gte', value: '40' }], limit: 5 }, 'Rooms = B202.', ['B202']),
  table('rooms-sum', 'rehearsal-rooms', 'Sum capacity for rooms in location North. Answer Total = <value>.',
    { dataset_id: 'rooms', operation: 'sum', field: 'capacity', filters: [eq('location', 'North')] }, 'Total = 70.', '70'),
  table('rooms-empty', 'rehearsal-rooms', 'Look up rooms with capacity at least 1000, limit 5. Answer Empty = yes if none match.',
    { dataset_id: 'rooms', operation: 'lookup', filters: [{ field: 'capacity', op: 'gte', value: '1000' }], limit: 5 }, 'Empty = yes.', []),
  { id: 'rooms-blocked', taskId: 'rehearsal-rooms', kind: 'blocked', goal: 'Try writing a draft from a read-only task.', tool: 'save_draft', args: { title: 'Forbidden', content: 'Test', source_ids: [] }, answer: 'Blocked.' },
];
