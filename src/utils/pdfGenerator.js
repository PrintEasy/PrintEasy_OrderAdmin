import jsPDF from "jspdf";
import JsBarcode from "jsbarcode";

/* ================= IMAGE LOADER ================= */
const loadImageAsBase64 = (url) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";

    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      canvas.getContext("2d").drawImage(img, 0, 0);
      resolve(canvas.toDataURL("image/png"));
    };

    img.onerror = async () => {
      try {
        const res = await fetch(url);
        const blob = await res.blob();
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(blob);
      } catch {
        reject();
      }
    };

    img.src = url;
  });

const safeLoadImage = async (url) => {
  try {
    return await loadImageAsBase64(url);
  } catch {
    return null;
  }
};

/* ================= PAGE HELPERS ================= */
const getPageSize = (doc) => ({
  width: doc.internal.pageSize.getWidth(),
  height: doc.internal.pageSize.getHeight(),
});

const ensureSpace = (doc, y, neededHeight, margin = 20) => {
  const { height } = getPageSize(doc);
  if (y + neededHeight > height - margin) {
    doc.addPage();
    return margin;
  }
  return y;
};

/* ================= IMAGE DRAWERS ================= */
const addFullWidthImage = (doc, imgData, y, margin = 15) => {
  const { width } = getPageSize(doc);
  const usableWidth = width - margin * 2;
  const props = doc.getImageProperties(imgData);
  const ratio = props.width / props.height;

  const imgWidth = usableWidth;
  const imgHeight = imgWidth / ratio;

  doc.addImage(imgData, "PNG", margin, y, imgWidth, imgHeight);
  return imgHeight;
};

const addCenteredImage = (doc, imgData, y, maxWidth = 90) => {
  const { width } = getPageSize(doc);
  const props = doc.getImageProperties(imgData);
  const ratio = props.width / props.height;

  const imgWidth = maxWidth;
  const imgHeight = imgWidth / ratio;
  const x = (width - imgWidth) / 2;

  doc.addImage(imgData, "PNG", x, y, imgWidth, imgHeight);
  return imgHeight;
};

/* ================= BARCODE ================= */
const addBarcode = (doc, text, y) => {
  const canvas = document.createElement("canvas");
  canvas.width = 300;
  canvas.height = 120;

  JsBarcode(canvas, text, {
    format: "CODE128",
    width: 2,
    height: 60,
    displayValue: true,
    fontSize: 14,
  });

  const img = canvas.toDataURL("image/png");
  const { width } = getPageSize(doc);
  const w = 140;
  const h = 55;
  const x = (width - w) / 2;

  doc.addImage(img, "PNG", x, y, w, h);
  return h;
};

/* ================= MAIN PDF ================= */
export const generatePDF = async (order) => {
  const doc = new jsPDF();
  const margin = 20;
  let y = margin;

  for (let i = 0; i < order.items.length; i++) {
    const item = order.items[i];

    /* ---------- ITEM HEADER ---------- */
    y = ensureSpace(doc, y, 30);
    doc.setFontSize(12);
    doc.setFont(undefined, "bold");
    doc.text(
      `Order ${order.orderId} — Item ${i + 1}/${order.items.length}`,
      getPageSize(doc).width / 2,
      y,
      { align: "center" }
    );
    y += 15;

    /* ---------- LARGE CUSTOM IMAGE ---------- */
    const customImg =
      await safeLoadImage(item.imageUrl || item.renderedImageUrl);

    if (customImg) {
      const tempHeight =
        (getPageSize(doc).width - 30) /
        (doc.getImageProperties(customImg).width /
          doc.getImageProperties(customImg).height);

      y = ensureSpace(doc, y, tempHeight);
      y += addFullWidthImage(doc, customImg, y);
      y += 15;
    }

    /* ---------- PRODUCT IMAGE ---------- */
    const productImg = await safeLoadImage(item.productImageUrl);
    if (productImg) {
      y = ensureSpace(doc, y, 110);
      y += addCenteredImage(doc, productImg, y);
      y += 15;
    }

    /* ---------- BARCODE ---------- */
    const barcodeText = `${order.orderId}-${item.sku}-${i + 1}`;
    y = ensureSpace(doc, y, 80);
    y += addBarcode(doc, barcodeText, y);
    y += 25;

    /* ---------- SEPARATOR ---------- */
    y = ensureSpace(doc, y, 20);
    doc.setDrawColor(200);
    doc.line(30, y, getPageSize(doc).width - 30, y);
    y += 20;
  }

  doc.save(`order-${order.orderId}.pdf`);
};
