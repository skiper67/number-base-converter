// Весь код расширения находится в этом файле. Сборка и сторонние библиотеки не нужны.
const vscode = require('vscode');

// Пункты меню: label виден пользователю, base нужен для вычислений.
const SYSTEMS = [
    { label: '2 — двоичная', base: 2 },
    { label: '8 — восьмеричная', base: 8 },
    { label: '10 — десятичная', base: 10 },
    { label: '16 — шестнадцатеричная', base: 16 }
];

// 1. Превращаем текст из выбранной системы в точное целое число BigInt.
function readNumber(text, base) {
    let digits = text.trim();
    if (digits.length === 0 || digits.length > 256) {
        throw new Error('Введите целое число длиной от 1 до 256 символов.');
    }
    const negative = digits.startsWith('-');
    if (digits.startsWith('-') || digits.startsWith('+')) digits = digits.slice(1);

    // Префикс можно писать, но он должен совпадать с выбранной системой.
    const prefix = digits.slice(0, 2).toLowerCase();
    const prefixBases = { '0b': 2, '0o': 8, '0x': 16 };
    if (prefixBases[prefix]) {
        if (prefixBases[prefix] !== base) throw new Error('Префикс числа не совпадает с исходной системой.');
        digits = digits.slice(2);
    }

    const patterns = { 2: /^[01]+$/, 8: /^[0-7]+$/, 10: /^[0-9]+$/, 16: /^[0-9a-f]+$/i };
    if (!patterns[base] || !patterns[base].test(digits)) {
        throw new Error('В числе есть недопустимые цифры для системы ' + base + '.');
    }
    const prefixes = { 2: '0b', 8: '0o', 10: '', 16: '0x' };
    const value = BigInt(prefixes[base] + digits);
    return negative ? -value : value;
}

// 2. Записываем число в целевой системе. Префиксы результата подходят для C/C++.
function writeNumber(value, base) {
    const negative = value < 0n;
    const digits = (negative ? -value : value).toString(base).toUpperCase();
    const prefixes = { 2: '0b', 8: digits === '0' ? '' : '0', 10: '', 16: '0x' };
    return (negative ? '-' : '') + prefixes[base] + digits;
}

// 3. Строим простую диаграмму: ширина цветной полосы зависит от счётчика.
function drawChart(counts) {
    const maximum = Math.max(1, ...Object.values(counts));
    return Object.entries(counts).map(([label, count]) => `
        <div class="bar-row">
            <span>${label}</span>
            <div class="track"><div class="bar" style="width:${count / maximum * 100}%"></div></div>
            <b>${count}</b>
        </div>`).join('');
}

// 4. Считаем статистику по истории и формируем обычную HTML-страницу.
function statisticsHtml(history, started) {
    const targets = { '2': 0, '8': 0, '10': 0, '16': 0 };
    const directions = {};
    for (const item of history) {
        targets[item.to]++;
        const direction = item.from + ' → ' + item.to;
        directions[direction] = (directions[direction] || 0) + 1;
    }
    const rows = history.map((item, index) => `<tr>
        <td>${index + 1}</td><td><code>${item.input}</code></td><td>${item.from} → ${item.to}</td>
        <td><code>${item.output}</code></td></tr>`).join('');

    // input и output безопасны для HTML: это только проверенные цифры, A–F, знак и префикс.
    return `<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
        <title>Статистика переводов</title>
        <style>
            body { font-family:var(--vscode-font-family, sans-serif); color:var(--vscode-editor-foreground); background:var(--vscode-editor-background); padding:24px; max-width:900px; margin:auto; }
            h1 { font-size:26px; } h2 { margin-top:32px; font-size:18px; }
            .muted { color:var(--vscode-descriptionForeground); line-height:1.6; }
            .total { font-size:40px; font-weight:bold; margin:20px 0 0; }
            .bar-row { display:grid; grid-template-columns:90px minmax(0,1fr) 45px; gap:12px; align-items:center; margin:12px 0; }
            .track { background:var(--vscode-textCodeBlock-background, #333); height:20px; border-radius:4px; overflow:hidden; }
            .bar { background:var(--vscode-button-background, #007acc); height:100%; }
            .table-scroll { overflow-x:auto; } table { border-collapse:collapse; width:100%; margin-top:16px; }
            th, td { text-align:left; padding:10px; border-bottom:1px solid var(--vscode-panel-border, #888); }
            code { font-family:var(--vscode-editor-font-family, monospace); overflow-wrap:anywhere; }
        </style></head><body>
        <h1>Статистика переводов</h1>
        <p class="muted">Начало сеанса: ${started.toLocaleString('ru-RU')}. Статистика хранится до перезагрузки окна или сброса.</p>
        <div class="total">${history.length}</div><div class="muted">успешных переводов</div>
        <h2>В какие системы переводили</h2>
        ${drawChart(targets)}
        <h2>Направления переводов</h2>
        ${history.length ? drawChart(directions) : '<p class="muted">Пока нет переводов. Выполните команду «Перевести число».</p>'}
        <h2>Какие числа переведены</h2>
        <div class="table-scroll"><table><thead><tr><th>№</th><th>Исходное число</th><th>Системы</th><th>Результат</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
        <p class="muted">Один успешный расчёт — один перевод, даже если результат только просмотрен.
        Отмена ввода и ошибки не учитываются. Отмена замены через Ctrl+Z не удаляет запись о расчёте.</p>
        </body></html>`;
}

// 5. VS Code вызывает activate при первом запуске одной из наших команд.
function activate(context) {
    // Эти данные находятся только в памяти и относятся к текущему окну VS Code.
    const history = [];
    let started = new Date();
    let panel;

    function refreshStatistics() {
        if (panel) panel.webview.html = statisticsHtml(history, started);
    }

    function showStatistics() {
        if (panel) panel.reveal();
        else {
            panel = vscode.window.createWebviewPanel('numberStatistics', 'Статистика переводов', vscode.ViewColumn.Beside, { enableScripts: false, localResourceRoots: [] });
            panel.onDidDispose(() => { panel = undefined; });
        }
        refreshStatistics();
    }

    // 6. Главная команда: выбор систем → перевод → запись истории → действие с результатом.
    async function convert() {
        const editor = vscode.window.activeTextEditor;
        const selection = editor ? editor.selection : undefined;
        const selectedText = editor ? editor.document.getText(selection).trim() : '';
        const version = editor ? editor.document.version : 0;

        const from = await vscode.window.showQuickPick(SYSTEMS, { placeHolder: 'Из какой системы переводим?' });
        if (!from) return; // Escape — просто выходим.
        const input = selectedText || await vscode.window.showInputBox({
            prompt: 'Введите целое число в системе ' + from.base,
            placeHolder: 'Например: 13, FF, 0xFF или -101',
            validateInput: text => { try { readNumber(text, from.base); } catch (error) { return error.message; } }
        });
        if (input === undefined) return;

        try {
            const value = readNumber(input, from.base);
            const to = await vscode.window.showQuickPick(SYSTEMS.filter(system => system.base !== from.base), { placeHolder: 'В какую систему переводим?' });
            if (!to) return;
            const output = writeNumber(value, to.base);
            history.push({ input: input.trim(), from: from.base, to: to.base, output });
            refreshStatistics();

            const actions = ['Скопировать', 'Статистика'];
            if (selectedText) actions.unshift('Заменить выделение');
            const action = await vscode.window.showInformationMessage(`${input.trim()} (${from.base}) = ${output} (${to.base})`, ...actions);
            if (action === 'Скопировать') await vscode.env.clipboard.writeText(output);
            if (action === 'Статистика') showStatistics();
            if (action === 'Заменить выделение') {
                // Пока меню было открыто, файл мог измениться. Старое место не трогаем.
                if (editor.document.isClosed || editor.document.version !== version) throw new Error('Файл изменился. Выделите число и повторите перевод.');
                const success = await editor.edit(edit => edit.replace(selection, output));
                if (!success) throw new Error('Редактор не разрешил замену. Результат можно скопировать.');
            }
        } catch (error) {
            vscode.window.showErrorMessage(error.message);
        }
    }

    // 7. Связываем команды из package.json с функциями и добавляем очистку ресурсов.
    context.subscriptions.push(
        vscode.commands.registerCommand('numberConverter.convert', convert),
        vscode.commands.registerCommand('numberConverter.statistics', showStatistics),
        vscode.commands.registerCommand('numberConverter.reset', () => {
            history.length = 0;
            started = new Date();
            refreshStatistics();
            vscode.window.showInformationMessage('Статистика сброшена. Начат новый сеанс.');
        }),
        { dispose() { if (panel) panel.dispose(); } }
    );
}

function deactivate() {}
module.exports = { activate, deactivate, readNumber, writeNumber, statisticsHtml };
