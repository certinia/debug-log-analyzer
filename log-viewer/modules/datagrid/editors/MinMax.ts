import {
  CellComponent,
  EmptyCallback,
  ValueBooleanCallback,
  ValueVoidCallback,
} from 'tabulator-tables';

import './MinMax.css';

export default function (
  cell: CellComponent,
  onRendered: EmptyCallback,
  success: ValueBooleanCallback,
  cancel: ValueVoidCallback,
  _editorParams: object
): HTMLElement | false {
  const container = document.createElement('span');

  //create and style inputs
  const start = document.createElement('input');
  start.min = '0';
  start.type = 'number';
  start.className = 'minMax-input input';
  start.placeholder = 'Min';

  const end = start.cloneNode() as HTMLInputElement;
  end.setAttribute('placeholder', 'Max');

  function buildValues() {
    start.step = getStep(start.value);
    end.step = getStep(end.value);
    success({
      start: start.value !== '' ? +start.value : null,
      end: end.value !== '' ? +end.value : null,
    });
  }

  function getStep(numValue: string) {
    let step = numValue.split('.')[1];
    if (step) {
      step = `0.${'0'.repeat(step.length - 1)}1`;
    } else {
      step = '1';
    }
    return step;
  }

  function keypress(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      buildValues();
    } else if (e.key === 'Escape') {
      cancel(true);
    }
  }

  start.addEventListener('change', buildValues);
  start.addEventListener('blur', buildValues);
  start.addEventListener('keydown', keypress);

  end.addEventListener('change', buildValues);
  end.addEventListener('blur', buildValues);
  end.addEventListener('keydown', keypress);

  container.appendChild(start);
  container.appendChild(end);

  return container;
}
