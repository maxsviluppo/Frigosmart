import { GoogleGenAI, Type } from "@google/genai";

let currentApiKey = process.env.GEMINI_API_KEY || "";

export const setGeminiApiKey = (key: string) => {
  currentApiKey = key;
};

const getAIInstance = () => {
  return new GoogleGenAI({ apiKey: currentApiKey });
};

export interface ProductInfo {
  name: string;
  expiryDate?: string; // ISO format or YYYY-MM-DD
  category: string;
}

export interface RecipeInfo {
  recipe: string;
  pairingIngredients: string[];
  alternatives?: string[];
}

export const analyzeProductImage = async (base64Image: string, focusDate: boolean = false): Promise<ProductInfo> => {
  const timeoutPromise = new Promise<never>((_, reject) => 
    setTimeout(() => reject(new Error("Analysis timeout")), 15000)
  );

  try {
    const ai = getAIInstance();
    const prompt = focusDate 
      ? "DATA SCADENZA: Identifica SOLO la data di scadenza (EXP/Best Before) in questo prodotto. Formato: DD-MM-YYYY."
      : "PRODOTTO: Identifica nome, categoria e data di scadenza (DD-MM-YYYY). Sii preciso e veloce.";

    const fetchPromise = ai.models.generateContent({
      model: "gemini-2.5-flash-lite",
      contents: [
        {
          parts: [
            {
              inlineData: {
                mimeType: "image/jpeg",
                data: base64Image.split(",")[1],
              },
            },
            {
              text: prompt,
            },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            name: {
              type: Type.STRING,
              description: "Il nome del prodotto identificato",
            },
            expiryDate: {
              type: Type.STRING,
              description: "La data di scadenza in formato DD-MM-YYYY, se non trovata lasciare vuoto o null",
            },
            category: {
              type: Type.STRING,
              description: "La categoria del prodotto (es. Latticini, Carne, Vegetali, Bevande)",
            },
          },
          required: focusDate ? ["expiryDate"] : ["name", "category"],
        },
      },
    });

    const response = await Promise.race([fetchPromise, timeoutPromise]) as any;

    const result = JSON.parse(response.text);
    return result as ProductInfo;
  } catch (error) {
    console.error("Error analyzing image:", error);
    throw error;
  }
};

export const generateRecipeSuggestion = async (
  expiringProducts: { name: string, category: string }[],
  otherFridgeProducts: { name: string, category: string }[] = []
): Promise<RecipeInfo> => {
  try {
    const ai = getAIInstance();
    const expiringList = expiringProducts.map(p => `${p.name} (${p.category})`).join(", ");
    const fridgeList = otherFridgeProducts.length > 0 
      ? otherFridgeProducts.slice(0, 10).map(p => `${p.name} (${p.category})`).join(", ")
      : "Non specificati";

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-lite",
      contents: [
        {
          text: `Sei uno chef anti-spreco stellato. 
          Ho questi prodotti in scadenza imminente: ${expiringList}.
          Inoltre, nel frigorifero ho anche questi altri ingredienti: ${fridgeList}.
          
          Crea una proposta culinaria che utilizzi PRIMARIAMENTE i prodotti in scadenza, integrandoli con quelli disponibili nel frigo se ha senso, oppure suggerendo piccoli extra.
          
          Fornisci:
          1. Una ricetta principale o consiglio gourmet (max 3 frasi) che valorizzi i prodotti in scadenza.
          2. Una lista di 3-5 ingredienti aggiuntivi (pairing) per completare il piatto (es. spezie, condimenti, basi).
          3. Due brevi alternative veloci ("alternatives") nel caso l'utente volesse qualcosa di diverso.
          
          Rispondi in formato JSON. Sii creativo, professionale e incoraggiante.`,
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            recipe: {
              type: Type.STRING,
              description: "La ricetta principale completa",
            },
            pairingIngredients: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "Ingredienti da abbinare",
            },
            alternatives: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "Due alternative veloci",
            }
          },
          required: ["recipe", "pairingIngredients", "alternatives"],
        },
      },
    });

    const result = JSON.parse(response.text);
    return result as RecipeInfo;
  } catch (error) {
    console.error("Error generating combined recipe:", error);
    return {
      recipe: "Crea una spadellata mista con i prodotti in scadenza, aggiungendo un filo d'olio, erbe aromatiche e una spolverata di formaggio se disponibile.",
      pairingIngredients: ["Olio EVO", "Erbe aromatiche", "Formaggio grattugiato", "Pane tostato"],
      alternatives: [
        "Frittata svuota-frigo classica",
        "Torta salata veloce con base sfoglia"
      ]
    };
  }
};

export const parseVoiceDate = async (text: string, referenceDate: string): Promise<string | null> => {
  try {
    const ai = getAIInstance();
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-lite",
      contents: [
        {
          text: `Sei un esperto di analisi di date. 
          Oggi è il ${referenceDate}.
          L'utente ha detto: "${text}".
          Interpreta la frase e restituisci la data corrispondente in formato DD-MM-YYYY.
          Gestisci formati relativi come "domani", "prossima settimana", "tra 5 giorni", "il primo lunedì del mese prossimo", "fine mese", ecc.
          Restituisci solo un oggetto JSON con il campo "date".`,
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            date: {
              type: Type.STRING,
              description: "La data interpretata in formato DD-MM-YYYY",
            }
          },
          required: ["date"],
        },
      },
    });

    const result = JSON.parse(response.text);
    return result.date;
  } catch (error) {
    console.error("Error parsing voice date:", error);
    return null;
  }
};

export interface ShoppingGenerationInfo {
  items: { name: string, category: string, reason: string }[];
}

export const generateShoppingItemsFromContent = async (
  consumedProducts: { name: string, category: string }[],
  expiringProducts: { name: string, category: string }[],
  suggestedRecipeIngredients: string[] = []
): Promise<ShoppingGenerationInfo> => {
  try {
    const ai = getAIInstance();
    const consumedList = consumedProducts.map(p => p.name).join(", ");
    const expiringList = expiringProducts.map(p => p.name).join(", ");
    const recipeList = suggestedRecipeIngredients.join(", ");

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-lite",
      contents: [
        {
          text: `Sei un assistente intelligente per la gestione della casa. 
          Devo generare una lista della spesa intelligente. 
          
          Dati attuali:
          - Prodotti finiti di recente: ${consumedList || "Nessuno"}
          - Prodotti in scadenza (da rimpiazzare presto): ${expiringList || "Nessuno"}
          - Ingredienti necessari per le ultime ricette suggerite: ${recipeList || "Nessuno"}
          
          Genera una lista di articoli da acquistare. 
          Per ogni articolo specifica:
          1. Il nome dell'articolo.
          2. La categoria (es. Latticini, Carne, Vegetali, Bevande, Altro).
          3. Il motivo (es. "Finito", "In scadenza", "Per ricetta").
          
          Restituisci i dati in formato JSON come un array di oggetti "items".`,
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            items: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  category: { type: Type.STRING },
                  reason: { type: Type.STRING }
                },
                required: ["name", "category", "reason"]
              }
            }
          },
          required: ["items"],
        },
      },
    });

    const result = JSON.parse(response.text);
    return result as ShoppingGenerationInfo;
  } catch (error) {
    console.error("Error generating shopping list:", error);
    return { items: [] };
  }
};
