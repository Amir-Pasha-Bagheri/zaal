// `@ev=` becomes a React prop. React spells most DOM events differently from HTML, and a
// handler under the wrong name is silently never called — so the mapping is its own suite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../zaal.mjs';

const props = src => [...compile(src, 'jsx').matchAll(/\son([A-Za-z]+)=/g)].map(m => 'on' + m[1]);

test('the short names Zaal adds', () => {
  assert.deepEqual(props('C A\n  div @click=a @input=b @change=c @submit=d "x"\n'),
    ['onClick', 'onInput', 'onChange', 'onSubmit']);
  assert.deepEqual(props('C A\n  div @focus=a @blur=b @key=c @over=d @out=e "x"\n'),
    ['onFocus', 'onBlur', 'onKeyDown', 'onMouseOver', 'onMouseLeave']);
});

test('a compound DOM event gets React spelling, not a capitalized first letter', () => {
  assert.deepEqual(props('C A\n  div @keyup=a @keydown=b @keypress=c "x"\n'),
    ['onKeyUp', 'onKeyDown', 'onKeyPress']);
  assert.deepEqual(props('C A\n  div @dblclick=a @auxclick=c @contextmenu=d "x"\n'),
    ['onDoubleClick', 'onAuxClick', 'onContextMenu']);
  assert.deepEqual(props('C A\n  div @doubleclick=b "x"\n'), ['onDoubleClick'],
    'the HTML and the React spelling are the same event');
  assert.deepEqual(props('C A\n  div @mouseenter=a @mouseleave=b @mousedown=c @mousemove=d "x"\n'),
    ['onMouseEnter', 'onMouseLeave', 'onMouseDown', 'onMouseMove']);
  assert.deepEqual(props('C A\n  div @pointerdown=a @pointerup=b @pointermove=c "x"\n'),
    ['onPointerDown', 'onPointerUp', 'onPointerMove']);
  assert.deepEqual(props('C A\n  div @touchstart=a @touchend=b @touchmove=c "x"\n'),
    ['onTouchStart', 'onTouchEnd', 'onTouchMove']);
  assert.deepEqual(props('C A\n  div @dragstart=a @dragover=b @drop=c @dragend=d "x"\n'),
    ['onDragStart', 'onDragOver', 'onDrop', 'onDragEnd']);
  assert.deepEqual(props('C A\n  div @animationend=a @transitionend=b @scrollend=c "x"\n'),
    ['onAnimationEnd', 'onTransitionEnd', 'onScrollEnd']);
  assert.deepEqual(props('C A\n  video @timeupdate=a @loadeddata=b @canplaythrough=c @volumechange=d\n'),
    ['onTimeUpdate', 'onLoadedData', 'onCanPlayThrough', 'onVolumeChange']);
});

test('an unknown name is still a callback prop — a component may name one anything', () => {
  assert.deepEqual(props('i Combo ./Combo\nC A\n  Combo @pick=a @rowSelect=b\n'),
    ['onPick', 'onRowSelect']);
});

test('both backends spell the handler the same way', () => {
  assert.match(compile('C A\n  div @keyup=a "x"\n', 'esm'), /"onKeyUp": a/);
});
