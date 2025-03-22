const puppeteer = require('puppeteer');

async function scrapeInvoice(url) {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle2' });
    
    // Extract data
    const invoiceData = await page.evaluate(() => {
        const grandTotal = document.querySelector('selector-for-total')?.innerText || '';
        const businessName = document.querySelector('selector-for-business-name')?.innerText || '';
        const payDeadline = document.querySelector('selector-for-pay-deadline')?.innerText || '';
        
        const items = Array.from(document.querySelectorAll('selector-for-items')).map(item => {
            return {
                name: item.querySelector('selector-for-item-name')?.innerText || '',
                pricePerUnit: item.querySelector('selector-for-item-price')?.innerText || '',
                totalPrice: item.querySelector('selector-for-item-total')?.innerText || ''
            };
        });
        
        return { grandTotal, businessName, payDeadline, items };
    });

    await browser.close();
    return invoiceData;
}

module.exports = { scrapeInvoice };
