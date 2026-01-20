import jsPDF from "jspdf";
import JsBarcode from "jsbarcode";

const loadImageAsBase64 = (url, quality = 0.5, applyThreshold = true) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";

    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");

      // Fill the background with white first (in case of transparent PNGs)
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);

      // Only apply threshold processing if requested (for product images)
      if (applyThreshold) {
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;

        // THRESHOLD: Increase this if black is still showing. 
        // 50 targets anything from pure black up to dark charcoal.
        const threshold = 50; 

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];

          // If the pixel is very dark (below threshold), make it white
          if (r < threshold && g < threshold && b < threshold) {
            data[i] = 255;     // R
            data[i + 1] = 255; // G
            data[i + 2] = 255; // B
          }
        }

        ctx.putImageData(imageData, 0, 0);
      }
      
      // Use JPEG with specified quality
      resolve(canvas.toDataURL("image/jpeg", quality));
    };

    img.onerror = () => reject();
    img.src = url;
  });

const safeLoadImage = async (url, quality = 0.5) => {
  try {
    return await loadImageAsBase64(url, quality);
  } catch {
    return null;
  }
};

// Higher quality loader for custom images (imageUrl)
// Preserves all colors including text - no threshold processing
const safeLoadCustomImage = async (url) => {
  try {
    // Use higher quality (0.75) for custom images and preserve all colors
    // applyThreshold = false to preserve text and all image details
    return await loadImageAsBase64(url, 0.75, false);
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

  // Use JPEG compression in addImage
  doc.addImage(
    imgData,
    "JPEG",
    margin,
    y,
    imgWidth,
    imgHeight,
    undefined,
    "FAST",
  );
  return imgHeight;
};

const addCenteredImage = (doc, imgData, y, maxWidth = 90) => {
  const { width } = getPageSize(doc);
  const props = doc.getImageProperties(imgData);
  const ratio = props.width / props.height;

  const imgWidth = maxWidth;
  const imgHeight = imgWidth / ratio;
  const x = (width - imgWidth) / 2;

  // Use JPEG compression in addImage
  doc.addImage(imgData, "JPEG", x, y, imgWidth, imgHeight, undefined, "FAST");
  return imgHeight;
};

/* ================= BARCODE ================= */
const addBarcode = (doc, text, y) => {
  const canvas = document.createElement("canvas");

  JsBarcode(canvas, text, {
    format: "CODE128",
    width: 2,
    height: 35, // Reduced height
    displayValue: true,
    fontSize: 12, // Slightly smaller font
  });

  const img = canvas.toDataURL("image/jpeg", 0.6);
  const { width } = getPageSize(doc);
  const w = 85; // Reduced width
  const h = 35; // Reduced height
  const x = (width - w) / 2;

  doc.addImage(img, "JPEG", x, y, w, h);
  return h;
};

/* ================= MAIN PDF ================= */
export const generatePDF = async (order, onProgress) => {
  // OPTIMIZATION: Set compress: true in the constructor
  const doc = new jsPDF({
    compress: true,
    precision: 2, // Reduce precision for smaller file size
  });

  const margin = 20;
  let y = margin;

  for (let i = 0; i < order.items.length; i++) {
    const item = order.items[i];

    // Report progress if callback provided
    if (onProgress) {
      onProgress(i + 1, order.items.length);
    }

    /* ---------- ITEM HEADER ---------- */
    y = ensureSpace(doc, y, 30);
    doc.setFontSize(12);
    doc.setFont(undefined, "bold");
    doc.text(
      `Order ${order.orderId} — Item ${i + 1}/${order.items.length}`,
      getPageSize(doc).width / 2,
      y,
      { align: "center" },
    );
    y += 15;

    /* ---------- LARGE CUSTOM IMAGE ---------- */
    const customImg = await safeLoadCustomImage(
      item.imageUrl || item.renderedImageUrl,
    );
    if (customImg) {
      const props = doc.getImageProperties(customImg);
      const tempHeight =
        (getPageSize(doc).width - 30) / (props.width / props.height);

      y = ensureSpace(doc, y, tempHeight);
      y += addFullWidthImage(doc, customImg, y);
      y += 10;
    }

    /* ---------- BARCODE (SKU REMOVED) ---------- */
    // Updated logic: only OrderID and Item Index
    const barcodeText = `${order.orderId}-${i + 1}`;
    y = ensureSpace(doc, y, 60);
    y += addBarcode(doc, barcodeText, y);
    y += 15;

    /* ---------- SEPARATOR ---------- */
    y = ensureSpace(doc, y, 15);
    doc.setDrawColor(220);
    doc.line(40, y, getPageSize(doc).width - 40, y);
    y += 15;
  }

  doc.save(`order-${order.orderId}.pdf`);
};

/* ================= GENERATE COMBINED PDF FOR MULTIPLE ORDERS ================= */
export const generateCombinedPDF = async (orders, dateKey, onProgress) => {
  // OPTIMIZATION: Set compress: true in the constructor
  const doc = new jsPDF({
    compress: true,
    precision: 2, // Reduce precision for smaller file size
  });

  const margin = 20;
  let y = margin;
  let totalItems = 0;
  
  // Calculate total items for progress tracking
  orders.forEach(order => {
    totalItems += order.items.length;
  });

  let processedItems = 0;

  for (let orderIndex = 0; orderIndex < orders.length; orderIndex++) {
    const order = orders[orderIndex];

    // Add order separator if not first order
    if (orderIndex > 0) {
      y = ensureSpace(doc, y, 30);
      doc.setDrawColor(200);
      doc.setLineWidth(2);
      doc.line(40, y, getPageSize(doc).width - 40, y);
      y += 20;
    }

    for (let i = 0; i < order.items.length; i++) {
      const item = order.items[i];
      processedItems++;

      // Report progress if callback provided
      if (onProgress) {
        onProgress(processedItems, totalItems);
      }

      /* ---------- ITEM HEADER ---------- */
      y = ensureSpace(doc, y, 30);
      doc.setFontSize(12);
      doc.setFont(undefined, "bold");
      doc.text(
        `Order ${order.orderId} — Item ${i + 1}/${order.items.length}`,
        getPageSize(doc).width / 2,
        y,
        { align: "center" },
      );
      y += 15;

      /* ---------- LARGE CUSTOM IMAGE ---------- */
      const customImg = await safeLoadCustomImage(
        item.imageUrl || item.renderedImageUrl,
      );
      if (customImg) {
        const props = doc.getImageProperties(customImg);
        const tempHeight =
          (getPageSize(doc).width - 30) / (props.width / props.height);

        y = ensureSpace(doc, y, tempHeight);
        y += addFullWidthImage(doc, customImg, y);
        y += 10;
      }

      /* ---------- BARCODE (SKU REMOVED) ---------- */
      // Updated logic: only OrderID and Item Index
      const barcodeText = `${order.orderId}-${i + 1}`;
      y = ensureSpace(doc, y, 60);
      y += addBarcode(doc, barcodeText, y);
      y += 15;

      /* ---------- SEPARATOR ---------- */
      y = ensureSpace(doc, y, 15);
      doc.setDrawColor(220);
      doc.line(40, y, getPageSize(doc).width - 40, y);
      y += 15;
    }
  }

  // Format date for filename (replace spaces and special chars)
  const safeDateKey = dateKey.replace(/[^a-zA-Z0-9]/g, '-');
  doc.save(`orders-${safeDateKey}.pdf`);
};
