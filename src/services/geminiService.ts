
// src/services/geminiService.ts
import { GoogleGenAI } from "@google/genai";
// Updated import to use InventoryItem instead of FabricItem
import { InventoryItem, Invoice } from "../types";

export const analyzeInventory = async (inventory: InventoryItem[], recentSales: Invoice[]) => {
  // CRITICAL: Always use process.env.API_KEY directly in initialization
  if (!process.env.API_KEY) {
    return "مفتاح API غير موجود. يرجى ضبطه في إعدادات النظام.";
  }

  // Correct initialization as per guidelines
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  // Updated inventorySummary to handle potential undefined fields in InventoryItem
  const inventorySummary = inventory.map(item => 
    `- ${item.name} (${item.color || 'بدون لون'}): ${item.rollsCount || 0} لفات, ${item.metersPerRoll || 0} متر/لفة`
  ).join('\n');

  const salesSummary = recentSales.slice(0, 5).map(inv => 
    `- فاتورة بتاريخ ${inv.date}: إجمالي ${inv.totalAmount} دولار`
  ).join('\n');

  const prompt = `
    أنت مساعد ذكي لمدير مستودع أقمشة.
    
    البيانات الحالية للمخزون:
    ${inventorySummary}

    آخر المبيعات:
    ${salesSummary}

    بناءً على هذه البيانات، قدم تقريراً قصيراً ومفيداً باللغة العربية يتضمن:
    1. ملخص لحالة المخزون.
    2. أي تحذيرات حول المخزون المنخفض.
    3. نصائح لزيادة المبيعات.
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
    });
    // Guidelines: Use .text property directly
    return response.text || "لم يتم استلام رد من النموذج.";
  } catch (error) {
    console.error("Gemini Error:", error);
    return "حدث خطأ أثناء تحليل البيانات.";
  }
};

export const analyzeAuditResults = async (auditItems: any[]) => {
  // Direct use of process.env.API_KEY is required
  if (!process.env.API_KEY) return "مفتاح API غير موجود.";

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  const discrepancies = auditItems.filter(item => item.diff !== 0).map(item => 
    `- الصنف: ${item.name}. النظام: ${item.systemRolls}, الفعلي: ${item.actualRolls}, الفرق: ${item.diff}.`
  ).join('\n');

  if (!discrepancies) return "نتائج الجرد مطابقة تماماً للنظام.";

  const prompt = `بصفتك خبير مخازن، حلل فروقات الجرد التالية: ${discrepancies}`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
    });
    // Guidelines: Use .text property directly
    return response.text || "لم يتم استلام رد.";
  } catch (error) {
    return "حدث خطأ أثناء تحليل نتائج الجرد.";
  }
};
