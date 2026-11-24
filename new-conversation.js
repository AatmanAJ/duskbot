(() => {
  const el = document.querySelector('textarea');
  const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
  let f = el[key];
  while (f) {
    const v = f.memoizedProps && f.memoizedProps.value;
    if (v && typeof v.dispatch === 'function' && v.state) {
      const bot = (v.state.bots || []).find((b) => b.name === 'Pepper');
      v.dispatch({ type: 'newTask', botId: bot.id });
      return 'dispatched ' + bot.id;
    }
    f = f.return;
  }
  return 'no store';
})()
