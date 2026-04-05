

const SHEET_CARDS  = 'Cards';
const SHEET_LOGS   = 'Logs';
const SHEET_CONFIG = 'Config';

const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'toll@2024';

const TOLL_RATES = {
  'bus': 200,
  'car': 100
};

const TIMEZONE = 'Asia/Dhaka';

function doGet(e) {
  const action = e.parameter.action;

  if (!action) {
    return HtmlService.createHtmlOutputFromFile('Index')
      .setTitle('Smart Toll System')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');
  }

  let result;
  try {
    switch (action) {
      case 'getLogs':        result = getAllLogs();                          break;
      case 'getCard':        result = getCardInfo(e.parameter.cardId);      break;
      case 'getCardLogs':    result = getCardLogs(e.parameter.cardId);      break;
      case 'getLastScan':    result = getLastScan();                        break;
      case 'getAllCards':     result = getAllCards();                         break;
      default:               result = { error: 'Unknown action: ' + action };
    }
  } catch (err) {
    result = { error: err.message };
  }

  return jsonResponse(result);
}

function doPost(e) {
  let data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonResponse({ error: 'Invalid JSON: ' + err.message });
  }

  let result;
  try {
    switch (data.action) {
      case 'deductToll':  result = deductToll(data.cardId);                                       break;
      case 'queryScan':   result = queryScan(data.cardId);                                        break;
      case 'adminLogin':  result = adminLogin(data.username, data.password);                      break;
      case 'updateCard':  result = updateCard(data);                                              break;
      case 'addBalance':     result = addBalance(data.cardId, parseFloat(data.amount), data.token);  break;
      case 'registerCard':   result = registerNewCard(data);                                          break;
      default:               result = { error: 'Unknown action: ' + data.action };
    }
  } catch (err) {
    result = { error: err.message };
  }

  return jsonResponse(result);
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function getActiveSpreadsheet() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function getOrCreateSheet(name) {
  const ss = getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (name === SHEET_CARDS) {
      sheet.appendRow(['Card ID', 'Name', 'Vehicle Type', 'Balance']);
      sheet.getRange(1, 1, 1, 4).setFontWeight('bold').setBackground('#1a73e8').setFontColor('#ffffff');
      sheet.setColumnWidth(1, 150);
      sheet.setColumnWidth(2, 150);
      sheet.setColumnWidth(3, 120);
      sheet.setColumnWidth(4, 100);
    } else if (name === SHEET_LOGS) {
      sheet.appendRow(['Timestamp', 'Card ID', 'Name', 'Vehicle Type', 'Toll Amount', 'Remaining Balance']);
      sheet.getRange(1, 1, 1, 6).setFontWeight('bold').setBackground('#0f9d58').setFontColor('#ffffff');
      sheet.setColumnWidth(1, 180);
      sheet.setColumnWidth(2, 150);
      sheet.setColumnWidth(3, 150);
      sheet.setColumnWidth(4, 120);
      sheet.setColumnWidth(5, 120);
      sheet.setColumnWidth(6, 150);
    } else if (name === SHEET_CONFIG) {
      sheet.appendRow(['key', 'value', 'updated_at']);
      sheet.getRange(1, 1, 1, 3).setFontWeight('bold');
      // Pre-seed config rows
      sheet.appendRow(['last_scan', '', '']);
      sheet.appendRow(['last_scan_time', '', '']);
    }
  }
  return sheet;
}

function getCardInfo(cardId) {
  if (!cardId) return { status: 'error', message: 'Card ID is required' };

  const sheet = getOrCreateSheet(SHEET_CARDS);
  const data  = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).toUpperCase().trim() === String(cardId).toUpperCase().trim()) {
      return {
        status: 'success',
        card: {
          cardId:      String(data[i][0]),
          name:        String(data[i][1]),
          vehicleType: String(data[i][2]),
          balance:     Number(data[i][3])
        }
      };
    }
  }
  return { status: 'not_found', message: 'Card not registered in system' };
}

function getAllCards() {
  const sheet = getOrCreateSheet(SHEET_CARDS);
  const data  = sheet.getDataRange().getValues();
  const cards = [];

  for (let i = 1; i < data.length; i++) {
    if (data[i][0]) {
      cards.push({
        cardId:      String(data[i][0]),
        name:        String(data[i][1]),
        vehicleType: String(data[i][2]),
        balance:     Number(data[i][3])
      });
    }
  }
  return { status: 'success', cards: cards, total: cards.length };
}

function updateCard(data) {
  if (!validateToken(data.token)) return { status: 'unauthorized' };
  if (!data.cardId)               return { status: 'error', message: 'Card ID required' };

  const sheet     = getOrCreateSheet(SHEET_CARDS);
  const sheetData = sheet.getDataRange().getValues();

  for (let i = 1; i < sheetData.length; i++) {
    if (String(sheetData[i][0]).toUpperCase().trim() === String(data.cardId).toUpperCase().trim()) {
      if (data.name        !== undefined && data.name.trim()        !== '') sheet.getRange(i + 1, 2).setValue(data.name.trim());
      if (data.vehicleType !== undefined && data.vehicleType.trim() !== '') sheet.getRange(i + 1, 3).setValue(data.vehicleType.trim());

      const updated = sheet.getRange(i + 1, 1, 1, 4).getValues()[0];
      return {
        status: 'success',
        card: {
          cardId:      String(updated[0]),
          name:        String(updated[1]),
          vehicleType: String(updated[2]),
          balance:     Number(updated[3])
        }
      };
    }
  }
  return { status: 'not_found' };
}

function addBalance(cardId, amount, token) {
  if (!validateToken(token))      return { status: 'unauthorized' };
  if (!cardId)                    return { status: 'error', message: 'Card ID required' };
  if (!amount || isNaN(amount) || amount <= 0)
                                  return { status: 'error', message: 'Invalid amount' };

  const sheet = getOrCreateSheet(SHEET_CARDS);
  const data  = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).toUpperCase().trim() === String(cardId).toUpperCase().trim()) {
      const prev     = Number(data[i][3]);
      const newBal   = prev + amount;
      sheet.getRange(i + 1, 4).setValue(newBal);

      return {
        status:          'success',
        cardId:          String(data[i][0]),
        name:            String(data[i][1]),
        addedAmount:     amount,
        previousBalance: prev,
        newBalance:      newBal
      };
    }
  }
  return { status: 'not_found' };
}

function deductToll(cardId) {
  if (!cardId) return { status: 'error', message: 'Card ID required' };

  const cardsSheet = getOrCreateSheet(SHEET_CARDS);
  const logsSheet  = getOrCreateSheet(SHEET_LOGS);
  const data       = cardsSheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).toUpperCase().trim() === String(cardId).toUpperCase().trim()) {

      const vehicleType = String(data[i][2]).toLowerCase().trim();
      const toll        = TOLL_RATES[vehicleType] !== undefined
                          ? TOLL_RATES[vehicleType]
                          : TOLL_RATES['car'];         // Default to car rate
      const balance     = Number(data[i][3]);

      setConfig('last_scan',      String(data[i][0]));
      setConfig('last_scan_time', new Date().toISOString());

      if (balance < toll) {
        return {
          status:      'insufficient',
          name:        String(data[i][1]),
          vehicleType: String(data[i][2]),
          balance:     balance,
          required:    toll
        };
      }

      const newBalance = balance - toll;

      cardsSheet.getRange(i + 1, 4).setValue(newBalance);

      const ts = Utilities.formatDate(new Date(), TIMEZONE, 'dd/MM/yyyy hh:mm:ss a');
      logsSheet.appendRow([
        ts,
        String(data[i][0]),
        String(data[i][1]),
        String(data[i][2]),
        toll,
        newBalance
      ]);

      return {
        status:          'success',
        name:            String(data[i][1]),
        vehicleType:     String(data[i][2]),
        toll:            toll,
        previousBalance: balance,
        newBalance:      newBalance
      };
    }
  }

  return { status: 'not_found', message: 'Card not registered' };
}

function queryScan(cardId) {
  if (!cardId) return { status: 'error', message: 'Card ID required' };

  setConfig('last_scan',      String(cardId));
  setConfig('last_scan_time', new Date().toISOString());

  return getCardInfo(cardId);
}

function getAllLogs() {
  const sheet = getOrCreateSheet(SHEET_LOGS);
  const data  = sheet.getDataRange().getValues();
  const logs  = [];

  for (let i = 1; i < data.length; i++) {
    if (data[i][0]) {
      logs.push({
        timestamp:        String(data[i][0]),
        cardId:           String(data[i][1]),
        name:             String(data[i][2]),
        vehicleType:      String(data[i][3]),
        tollAmount:       Number(data[i][4]),
        remainingBalance: Number(data[i][5])
      });
    }
  }

  logs.reverse();
  return { status: 'success', logs: logs, total: logs.length };
}

function getCardLogs(cardId) {
  if (!cardId) return { status: 'error', message: 'Card ID required' };

  const sheet = getOrCreateSheet(SHEET_LOGS);
  const data  = sheet.getDataRange().getValues();
  const logs  = [];

  for (let i = 1; i < data.length; i++) {
    if (data[i][1] && String(data[i][1]).toUpperCase().trim() === String(cardId).toUpperCase().trim()) {
      logs.push({
        timestamp:        String(data[i][0]),
        cardId:           String(data[i][1]),
        name:             String(data[i][2]),
        vehicleType:      String(data[i][3]),
        tollAmount:       Number(data[i][4]),
        remainingBalance: Number(data[i][5])
      });
    }
  }

  logs.reverse();
  return { status: 'success', cardId: cardId, logs: logs, total: logs.length };
}

function adminLogin(username, password) {
  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    // Simple session token (stateless, encoded timestamp)
    const token = 'admin_' + Utilities.base64Encode(username + '_' + new Date().getTime());
    return { status: 'success', token: token };
  }
  return { status: 'unauthorized', message: 'Invalid credentials' };
}

function validateToken(token) {
  return typeof token === 'string' && token.startsWith('admin_');
}

function setConfig(key, value) {
  const sheet = getOrCreateSheet(SHEET_CONFIG);
  const data  = sheet.getDataRange().getValues();

  for (let i = 0; i < data.length; i++) {
    if (String(data[i][0]) === key) {
      sheet.getRange(i + 1, 2).setValue(value);
      sheet.getRange(i + 1, 3).setValue(new Date().toISOString());
      return;
    }
  }
  sheet.appendRow([key, value, new Date().toISOString()]);
}

function getLastScan() {
  const sheet = getOrCreateSheet(SHEET_CONFIG);
  const data  = sheet.getDataRange().getValues();
  let cardId = '', ts = '';

  for (let i = 0; i < data.length; i++) {
    if (String(data[i][0]) === 'last_scan')      cardId = String(data[i][1]);
    if (String(data[i][0]) === 'last_scan_time') ts     = String(data[i][1]);
  }
  return { status: 'success', cardId: cardId, timestamp: ts };
}

function getLogsForWeb()              { return getAllLogs(); }
function getCardInfoForWeb(cardId)    { return getCardInfo(cardId); }
function getCardLogsForWeb(cardId)    { return getCardLogs(cardId); }
function getLastScanForWeb()          { return getLastScan(); }
function adminLoginForWeb(u, p)       { return adminLogin(u, p); }
function getAllCardsForWeb()           { return getAllCards(); }

function updateCardForWeb(cardId, name, vehicleType, token) {
  return updateCard({ cardId, name, vehicleType, token });
}

function addBalanceForWeb(cardId, amount, token) {
  return addBalance(cardId, amount, token);
}

function registerNewCardForWeb(cardId, name, vehicleType, balance, token) {
  return registerNewCard({ cardId: cardId, name: name, vehicleType: vehicleType, balance: balance, token: token });
}

function registerNewCard(data) {
  if (!validateToken(data.token))  return { status: 'unauthorized' };

  var cardId      = String(data.cardId || '').toUpperCase().trim();
  var name        = String(data.name   || '').trim();
  var vehicleType = String(data.vehicleType || 'car').toLowerCase().trim();
  var balance     = parseFloat(data.balance) || 0;

  if (!cardId)  return { status: 'error', message: 'Card ID is required' };
  if (!name)    return { status: 'error', message: 'Owner name is required' };
  if (vehicleType !== 'car' && vehicleType !== 'bus')
                return { status: 'error', message: 'Vehicle type must be car or bus' };
  if (balance < 0)
                return { status: 'error', message: 'Balance cannot be negative' };

  var sheet = getOrCreateSheet(SHEET_CARDS);
  var rows  = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).toUpperCase().trim() === cardId) {
      return { status: 'duplicate', message: 'This card is already registered' };
    }
  }

  sheet.appendRow([cardId, name, vehicleType, balance]);

  return {
    status: 'success',
    card: { cardId: cardId, name: name, vehicleType: vehicleType, balance: balance }
  };
}

function deleteCardForWeb(cardId, token) {
  return deleteCard(cardId, token);
}

function deleteCard(cardId, token) {
  if (!validateToken(token)) return { status: 'unauthorized' };

  cardId = String(cardId || '').toUpperCase().trim();
  if (!cardId) return { status: 'error', message: 'Card ID required' };

  var sheet = getOrCreateSheet(SHEET_CARDS);
  var rows  = sheet.getDataRange().getValues();

  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).toUpperCase().trim() === cardId) {
      sheet.deleteRow(i + 1);
      return { status: 'success', cardId: cardId };
    }
  }

  return { status: 'not_found', message: 'Card not found' };
}