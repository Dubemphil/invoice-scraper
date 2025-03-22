
const { GoogleSpreadsheet } = require('google-spreadsheet');
const creds = require('./credentials.json'); // Google service account credentials

async function accessSheet(sheetId) {
    const doc = new GoogleSpreadsheet(sheetId);
    await doc.useServiceAccountAuth(creds);
    await doc.loadInfo();
    return doc.sheetsByIndex[0];
}

async function updateSheet(sheet, rowIndex, data) {
    const rows = await sheet.getRows();
    Object.keys(data).forEach(key => {
        rows[rowIndex][key] = data[key];
    });
    await rows[rowIndex].save();
}

module.exports = { accessSheet, updateSheet };