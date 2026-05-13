/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  Camera, 
  Plus, 
  Trash2, 
  Calendar, 
  ChevronLeft, 
  Check, 
  AlertCircle, 
  Refrigerator,
  Info,
  History,
  X,
  RefreshCw,
  Search,
  Settings,
  Bell,
  Edit3,
  CheckSquare,
  Square,
  Milk,
  Beef,
  Leaf,
  CupSoda,
  Apple,
  Box,
  ChevronRight,
  Soup,
  CookingPot,
  Mic,
  MicOff,
  Save,
  ShoppingBag,
  Sparkles,
  Mail,
  LogIn,
  LogOut,
  Volume2,
  VolumeX
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format, isBefore, addDays, differenceInDays, parseISO, isValid } from 'date-fns';
import { it } from 'date-fns/locale';
import { analyzeProductImage, ProductInfo, generateRecipeSuggestion, RecipeInfo, parseVoiceDate, generateShoppingItemsFromContent, setGeminiApiKey } from './services/geminiService';
import { Product, AppView, NotificationSettings, ShoppingItem } from './types';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { 
  auth, db, googleProvider, signInWithPopup, signOut, onAuthStateChanged, User,
  collection, doc, setDoc, getDoc, onSnapshot, query, orderBy, deleteDoc, updateDoc,
  handleFirestoreError, OperationType
} from './lib/firebase';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const dmyToIso = (dateStr: string) => {
  if (!dateStr) return dateStr;
  // If it's already ISO (YYYY-MM-DD), return it
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  // If it's DD-MM-YYYY, convert to YYYY-MM-DD
  const parts = dateStr.split('-');
  if (parts.length === 3 && parts[0].length === 2) {
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
  }
  return dateStr;
};

const getSafeDate = (dateStr: string) => {
  const d = parseISO(dateStr);
  return isValid(d) ? d : new Date();
};

const getExpiryProgress = (addedDate: string, expiryDate: string) => {
  const start = parseISO(addedDate);
  const end = parseISO(expiryDate);
  const now = new Date();
  
  if (!isValid(start) || !isValid(end)) return 0;
  
  const total = differenceInDays(end, start);
  const elapsed = differenceInDays(now, start);
  
  if (total <= 0) return 100;
  if (elapsed <= 0) return 0;
  
  return Math.min(100, (elapsed / total) * 100);
};

const getCategoryIcon = (category: string) => {
  switch (category) {
    case 'Latticini': return <Milk size={20} />;
    case 'Carne': return <Beef size={20} />;
    case 'Vegetali': return <Leaf size={20} />;
    case 'Bevande': return <CupSoda size={20} />;
    case 'Frutta': return <Apple size={20} />;
    default: return <Box size={20} />;
  }
};

const renderDate = (dateStr: string, formatStr: string) => {
  const d = parseISO(dateStr);
  if (!isValid(d)) return 'Data non valida';
  return format(d, formatStr, { locale: it });
};

export default function App() {
  const [view, setView] = useState<AppView>('list');
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [isScanningDate, setIsScanningDate] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [scannedInfo, setScannedInfo] = useState<Partial<Product> | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [notificationSettings, setNotificationSettings] = useState<NotificationSettings>({
    daysBefore: 3,
    enabledCategories: ['Latticini', 'Carne', 'Vegetali', 'Bevande', 'Frutta', 'Altro'],
    allCategories: ['Latticini', 'Carne', 'Vegetali', 'Bevande', 'Frutta', 'Altro']
  });
  const [newCategoryName, setNewCategoryName] = useState('');
  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [deletingCategory, setDeletingCategory] = useState<string | null>(null);
  const [sessionReminderDone, setSessionReminderDone] = useState(false);
  const [expiringSoonProducts, setExpiringSoonProducts] = useState<Product[]>([]);
  const [showReminder, setShowReminder] = useState(false);
  const [shoppingItems, setShoppingItems] = useState<ShoppingItem[]>([]);
  const [newManualShoppingItem, setNewManualShoppingItem] = useState('');
  const [addingManual, setAddingManual] = useState(false);
  const [lastSuggestedIngredients, setLastSuggestedIngredients] = useState<string[]>([]);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const audioContextRef = useRef<AudioContext | null>(null);
  const deletionTimers = useRef<{ [id: string]: NodeJS.Timeout }>({});

  const playMuffledClick = () => {
    if (!audioEnabled) return;
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const ctx = audioContextRef.current;
      if (ctx.state === 'suspended') ctx.resume();
      
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(100, ctx.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(30, ctx.currentTime + 0.1);

      gainNode.gain.setValueAtTime(0.05, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);

      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);

      oscillator.start();
      oscillator.stop(ctx.currentTime + 0.1);
    } catch (e) {
      console.error("Audio failed", e);
    }
  };

  const playMechanicalClick = () => {
    if (!audioEnabled) return;
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const ctx = audioContextRef.current;
      if (ctx.state === 'suspended') ctx.resume();
      
      // Main "thump" - muffled body
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'triangle';
      osc1.frequency.setValueAtTime(120, ctx.currentTime);
      osc1.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + 0.1);
      gain1.gain.setValueAtTime(0.06, ctx.currentTime);
      gain1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
      
      // Mechanical "knock" - slightly higher but very quick decay
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(250, ctx.currentTime);
      osc2.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + 0.04);
      gain2.gain.setValueAtTime(0.03, ctx.currentTime);
      gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.04);

      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);

      osc1.start();
      osc2.start();
      osc1.stop(ctx.currentTime + 0.1);
      osc2.stop(ctx.currentTime + 0.1);
    } catch (e) {
      console.error("Mechanical audio failed", e);
    }
  };
  
  // Sync Gemini API Key with service
  useEffect(() => {
    if (notificationSettings.geminiApiKey) {
      setGeminiApiKey(notificationSettings.geminiApiKey);
    }
  }, [notificationSettings.geminiApiKey]);

  // Auth listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Sync Products from Firestore
  useEffect(() => {
    if (!user) {
      setProducts([]);
      return;
    }

    const q = query(
      collection(db, 'users', user.uid, 'products'),
      orderBy('addedDate', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Product));
      setProducts(docs);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `users/${user.uid}/products`);
    });

    return () => unsubscribe();
  }, [user]);

  // Sync Shopping Items from Firestore
  useEffect(() => {
    if (!user) {
      setShoppingItems([]);
      return;
    }

    const q = query(
      collection(db, 'users', user.uid, 'shopping_items'),
      orderBy('addedDate', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ShoppingItem));
      setShoppingItems(docs);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `users/${user.uid}/shopping_items`);
    });

    return () => unsubscribe();
  }, [user]);

  // Auto-delete consumed products after 10 seconds
  useEffect(() => {
    if (!user) return;
    
    const currentConsumedIds = new Set<string>(products.filter(p => p.consumed).map(p => p.id));
    
    // Start timers for newly consumed products
    currentConsumedIds.forEach((id: string) => {
      if (!deletionTimers.current[id]) {
        deletionTimers.current[id] = setTimeout(() => {
          removeProduct(id);
          delete deletionTimers.current[id];
        }, 10000);
      }
    });

    // Cleanup timers for products no longer consumed (or removed)
    Object.keys(deletionTimers.current).forEach(id => {
      if (!currentConsumedIds.has(id)) {
        clearTimeout(deletionTimers.current[id]);
        delete deletionTimers.current[id];
      }
    });

    return () => {
      // Don't clear all on every render, only on unmount or if we want strict behavior
      // But actually, we want to clear them when products changes and they are no longer consumed.
    };
  }, [products, user]);

  // Sync Settings from Firestore
  useEffect(() => {
    if (!user) return;

    const userDocRef = doc(db, 'users', user.uid);
    const unsubscribe = onSnapshot(userDocRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        if (data.notification_settings) {
          const settings = data.notification_settings;
          if (!settings.allCategories) {
            settings.allCategories = ['Latticini', 'Carne', 'Vegetali', 'Bevande', 'Frutta', 'Altro'];
          }
          setNotificationSettings(settings);
        }
      } else {
        // Initialize user document if it doesn't exist
        setDoc(userDocRef, {
          email: user.email,
          notification_settings: notificationSettings
        }).catch(err => handleFirestoreError(err, OperationType.CREATE, `users/${user.uid}`));
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `users/${user.uid}`);
    });

    return () => unsubscribe();
  }, [user]);

  const handleLogin = async () => {
    playMuffledClick();
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error("Login failed:", error);
    }
  };

  const handleLogout = async () => {
    playMuffledClick();
    try {
      await signOut(auth);
      setView('list');
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  useEffect(() => {
    if (products.length > 0 && !sessionReminderDone) {
      const today = new Date();
      const soon = products.filter(p => {
        if (p.consumed) return false;
        const expiry = parseISO(p.expiryDate);
        if (!isValid(expiry)) return false;
        const diff = differenceInDays(expiry, today);
        return diff >= 0 && diff <= 2;
      });

      if (soon.length > 0) {
        setExpiringSoonProducts(soon);
        setShowReminder(true);
        setSessionReminderDone(true);
      }
    }
  }, [products, sessionReminderDone]);

  const startCamera = () => {
    setView('camera');
  };

  const startManualEntry = () => {
    setScannedInfo({
      name: "",
      expiryDate: format(addDays(new Date(), 7), 'yyyy-MM-dd'),
      category: "Altro"
    });
    setIsEditing(false);
    setView('confirm');
  };

  const handleCapture = async (base64Image: string) => {
    setLoading(true);
    try {
      console.log("Analyzing image...", isScanningDate ? "(Date scan mode)" : "(Full scan mode)");
      const info = await analyzeProductImage(base64Image, isScanningDate);
      const isoDate = info.expiryDate ? dmyToIso(info.expiryDate) : null;
      
      if (isScanningDate && scannedInfo) {
        setScannedInfo({
          ...scannedInfo,
          expiryDate: isoDate || scannedInfo.expiryDate
        });
        setView('confirm');
      } else {
        setScannedInfo({
          name: info.name || "Prodotto",
          expiryDate: isoDate || format(addDays(new Date(), 7), 'yyyy-MM-dd'),
          category: info.category || "Altro"
        });
        setView('confirm');
      }
    } catch (error) {
      console.error("AI Analysis failed:", error);
      if (!isScanningDate) {
        setScannedInfo({
          name: "Prodotto non riconosciuto",
          expiryDate: format(addDays(new Date(), 7), 'yyyy-MM-dd'),
          category: "Altro"
        });
        setView('confirm');
      } else {
        // If scanning date fails, just go back to confirm view
        setView('confirm');
      }
    } finally {
      setLoading(false);
      setIsScanningDate(false);
    }
  };

  const startExpiryDateScan = () => {
    setIsScanningDate(true);
    setView('camera');
  };

  const startVoiceInput = () => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      alert("Il tuo browser non supporta il riconoscimento vocale.");
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.lang = 'it-IT';
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => setIsListening(false);
    recognition.onerror = () => setIsListening(false);

    recognition.onresult = async (event: any) => {
      const transcript = event.results[0][0].transcript.toLowerCase();
      console.log('Voice transcript:', transcript);
      
      setLoading(true);
      try {
        const todayStr = format(new Date(), "yyyy-MM-dd");
        const parsedDate = await parseVoiceDate(transcript, todayStr);
        const isoDate = parsedDate ? dmyToIso(parsedDate) : null;
        
        if (isoDate && scannedInfo) {
          setScannedInfo({ ...scannedInfo, expiryDate: isoDate });
        }
      } catch (error) {
        console.error("AI Voice parsing failed:", error);
      } finally {
        setLoading(false);
      }
    };

    recognition.start();
  };

  const addNewCategory = (name: string) => {
    if (!name.trim()) return;
    const normalizedName = name.trim();
    if (notificationSettings.allCategories?.includes(normalizedName)) {
      setScannedInfo(prev => prev ? { ...prev, category: normalizedName } : null);
      setIsAddingCategory(false);
      setNewCategoryName('');
      return;
    }

    const updatedCategories = [...(notificationSettings.allCategories || []), normalizedName];
    const updatedEnabled = [...notificationSettings.enabledCategories, normalizedName];
    
    updateNotificationSettings({
      ...notificationSettings,
      allCategories: updatedCategories,
      enabledCategories: updatedEnabled
    });

    setScannedInfo(prev => prev ? { ...prev, category: normalizedName } : null);
    setIsAddingCategory(false);
    setNewCategoryName('');
  };

  const editCategory = (oldName: string, newNameFromWheel?: string) => {
    const newName = newNameFromWheel || prompt("Modifica nome categoria:", oldName);
    if (!newName || newName === oldName) return;

    const updatedCategories = notificationSettings.allCategories?.map(c => c === oldName ? newName : c) || [];
    const updatedEnabled = notificationSettings.enabledCategories.map(c => c === oldName ? newName : c);
    
    updateNotificationSettings({
      ...notificationSettings,
      allCategories: updatedCategories,
      enabledCategories: updatedEnabled
    });

    // Update all products with this category
    products.forEach(async (p) => {
      if (p.category === oldName && user) {
        try {
          await updateDoc(doc(db, 'users', user.uid, 'products', p.id), { category: newName });
        } catch (e) {
          console.error("Failed to update product category", e);
        }
      }
    });

    // Update shopping items
    shoppingItems.forEach(async (i) => {
      if (i.category === oldName && user) {
        try {
          await updateDoc(doc(db, 'users', user.uid, 'shopping_items', i.id), { category: newName });
        } catch (e) {
          console.error("Failed to update shopping item category", e);
        }
      }
    });
  };

  const removeCategory = (name: string) => {
    const updatedCategories = notificationSettings.allCategories?.filter(c => c !== name) || [];
    const updatedEnabled = notificationSettings.enabledCategories.filter(c => c !== name);
    
    updateNotificationSettings({
      ...notificationSettings,
      allCategories: updatedCategories,
      enabledCategories: updatedEnabled
    });

    setDeletingCategory(null);
  };

  const addProduct = async (product: Partial<Product>) => {
    if (!product.name || !product.expiryDate || !user) return;

    try {
      if (isEditing && product.id) {
        const productRef = doc(db, 'users', user.uid, 'products', product.id);
        const { id, ...updateData } = product;
        // Sanitize undefined values for Firestore
        const cleanUpdateData = Object.fromEntries(
          Object.entries({ ...updateData, userId: user.uid }).filter(([_, v]) => v !== undefined)
        );
        await updateDoc(productRef, cleanUpdateData);
      } else {
        const newProductRef = doc(collection(db, 'users', user.uid, 'products'));
        const newProduct: Omit<Product, 'id'> = {
          name: product.name,
          expiryDate: product.expiryDate,
          category: product.category || 'Altro',
          addedDate: new Date().toISOString(),
          consumed: false,
          customReminderDays: product.customReminderDays ?? null,
          notes: product.notes || '',
          userId: user.uid
        };
        await setDoc(newProductRef, newProduct);
      }
      
      setView('list');
      setScannedInfo(null);
      setIsEditing(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}/products`);
    }
  };

  const editProduct = (product: Product) => {
    setScannedInfo(product);
    setIsEditing(true);
    setView('confirm');
  };

  const toggleConsumed = async (id: string) => {
    if (!user) return;
    const product = products.find(p => p.id === id);
    if (!product) return;

    try {
      const productRef = doc(db, 'users', user.uid, 'products', id);
      await updateDoc(productRef, { consumed: !product.consumed });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}/products/${id}`);
    }
  };

  const addManualShoppingItem = async () => {
    if (!user || !newManualShoppingItem.trim()) return;
    setAddingManual(true);
    try {
      const itemRef = doc(collection(db, 'users', user.uid, 'shopping_items'));
      await setDoc(itemRef, {
        name: newManualShoppingItem.trim(),
        category: 'Altro',
        checked: false,
        source: 'manual',
        addedDate: new Date().toISOString(),
        userId: user.uid
      });
      setNewManualShoppingItem("");
    } catch (e) {
      console.error("Error adding manual item", e);
    } finally {
      setAddingManual(false);
    }
  };

  const generateAIShoppingList = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const consumed = products.filter(p => p.consumed).map(p => ({ name: p.name, category: p.category }));
      const expiring = products.filter(p => {
        const diff = differenceInDays(getSafeDate(p.expiryDate), new Date());
        return diff >= 0 && diff <= 2;
      }).map(p => ({ name: p.name, category: p.category }));
      
      const { items } = await generateShoppingItemsFromContent(consumed, expiring, lastSuggestedIngredients);
      
      // Batch-like additions (though not using a WriteBatch for simplicity here)
      const existingNames = new Set(shoppingItems.map(i => i.name.toLowerCase()));
      const uniqueNewItems = items.filter(i => !existingNames.has(i.name.toLowerCase()));
      
      for (const item of uniqueNewItems) {
        const itemRef = doc(collection(db, 'users', user.uid, 'shopping_items'));
        await setDoc(itemRef, {
          name: item.name,
          category: item.category,
          checked: false,
          source: item.reason.toLowerCase().includes('ricetta') ? 'recipe' : 
                  item.reason.toLowerCase().includes('finito') ? 'finished' : 'manual',
          addedDate: new Date().toISOString(),
          userId: user.uid
        });
      }
    } catch (e) {
      console.error("Failed to generate shopping list", e);
    } finally {
      setLoading(false);
    }
  };

  const removeProduct = async (id: string) => {
    if (!user) return;
    try {
      const productRef = doc(db, 'users', user.uid, 'products', id);
      await deleteDoc(productRef);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `users/${user.uid}/products/${id}`);
    }
  };

  const toggleCheckShoppingItem = async (id: string) => {
    if (!user) return;
    const item = shoppingItems.find(i => i.id === id);
    if (!item) return;

    try {
      const itemRef = doc(db, 'users', user.uid, 'shopping_items', id);
      await updateDoc(itemRef, { checked: !item.checked });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}/shopping_items/${id}`);
    }
  };

  const removeShoppingItem = async (id: string) => {
    if (!user) return;
    try {
      const itemRef = doc(db, 'users', user.uid, 'shopping_items', id);
      await deleteDoc(itemRef);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `users/${user.uid}/shopping_items/${id}`);
    }
  };

  const clearShoppingItems = async () => {
    if (!user) return;
    try {
      // In Firestore we have to delete one by one or using batch
      for (const item of shoppingItems) {
        await deleteDoc(doc(db, 'users', user.uid, 'shopping_items', item.id));
      }
    } catch (error) {
      console.error("Failed to clear shopping list", error);
    }
  };

  const updateNotificationSettings = async (settings: NotificationSettings) => {
    if (!user) return;
    setNotificationSettings(settings);
    try {
      const userDocRef = doc(db, 'users', user.uid);
      await updateDoc(userDocRef, { notification_settings: settings });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
    }
  };

  const getStatusClasses = (product: Product) => {
    const today = new Date();
    const expiry = getSafeDate(product.expiryDate);
    const diff = differenceInDays(expiry, today);

    if (diff < 0) return 'text-rose-400 bg-rose-500/10 border-rose-500/20'; // Expired
    
    const isCategoryEnabled = notificationSettings.enabledCategories.includes(product.category);
    // Custom reminder takes precedence if set, otherwise use global settings
    const threshold = (product.customReminderDays !== undefined && product.customReminderDays !== null) ? product.customReminderDays : (isCategoryEnabled ? notificationSettings.daysBefore : -1);
    
    if (diff <= threshold) {
      return 'text-amber-400 bg-amber-500/10 border-amber-500/20'; // Critical based on settings or custom reminder
    }
    
    return 'text-slate-400 bg-slate-800 border-slate-700/50'; // OK
  };

  const filteredProducts = products.filter(p => 
    p.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const sortedProducts = [...filteredProducts].sort((a, b) => {
    // Primary sort: consumed state (not consumed first)
    if (a.consumed !== b.consumed) {
      return Number(a.consumed) - Number(b.consumed);
    }

    // Secondary sort: expiry date ascending
    return new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime();
  });

  const expiredCount = products.filter(p => {
    const diff = differenceInDays(getSafeDate(p.expiryDate), new Date());
    const isCategoryEnabled = notificationSettings.enabledCategories.includes(p.category);
    const threshold = (p.customReminderDays !== undefined && p.customReminderDays !== null) ? p.customReminderDays : (isCategoryEnabled ? notificationSettings.daysBefore : -1);
    return diff < 0 || diff <= threshold;
  }).length;

  return (
    <div className="min-h-screen bg-[#E0E5EC] font-sans text-slate-700 selection:bg-indigo-500/30 overflow-x-hidden relative">
      {/* Navy Blue Section with Wave Divider */}
      <div className="absolute top-0 left-0 w-full h-[350px] bg-navy-deep z-0">
        <div className="absolute bottom-[-1px] left-0 w-full leading-[0] overflow-hidden">
          <svg className="relative block w-[calc(100%+1.3px)] h-[120px]" data-name="Layer 1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 120" preserveAspectRatio="none">
            <path d="M0,0V46.29c47.79,22.2,103.59,32.17,158,28,70.36-5.37,136.33-33.31,206.8-37.5,73.84-4.36,147.54,16.88,218.2,35.26,69.27,18,138.3,24.88,209.4,13.08,36.15-6,69.85-17.84,104.45-29.34C989.49,25,1113-14.29,1200,52.47V0Z" opacity=".25" fill="#E0E5EC"></path>
            <path d="M0,0V15.81C13,36.92,27.64,56.86,47.69,72.05,99.41,111.27,165,111,224.58,91.58c31.15-10.15,60.09-26.07,89.67-39.8,40.92-19,84.73-46,130.83-49.67,36.26-2.85,70.9,9.42,98.6,31.56,31.77,25.39,62.32,62,103.63,73,40.44,10.79,81.35-6.69,119.13-24.28s75.16-39,116.92-43.05c59.73-5.85,113.28,22.88,168.9,38.84,30.2,8.66,59,6.17,87.09-7.5V0Z" opacity=".5" fill="#E0E5EC"></path>
            <path d="M0,0V5.63C149.93,59,314.09,71.32,475.83,42.57c43-7.64,84.23-20.12,127.61-26.46,59-8.63,112.48,12.24,165.56,35.4C827.93,77.22,886,95.24,951.2,90c86.53-7,172.46-45.71,248.8-84.81V0Z" fill="#E0E5EC"></path>
          </svg>
        </div>
      </div>

      {/* Header Navigation */}
      <nav className="h-28 px-8 flex items-center justify-between sticky top-0 z-40 bg-ice-grey/80 backdrop-blur-xl border-b border-white/20 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 neumorphic-raised rounded-2xl flex items-center justify-center pb-[2px]">
            <Refrigerator className="w-6 h-6 text-indigo-500" />
          </div>
          <div>
            <h1 className="text-lg font-display font-black tracking-widest text-navy-deep leading-none uppercase">
              FRIGOSMART
            </h1>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-[0.1em] mt-1.5 md:mt-2">Personal Assistant AI</p>
          </div>
        </div>
        
        <div className="flex items-center gap-6">
          {user && (
            <div className="hidden sm:flex flex-col items-end mr-2">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1 text-right w-full">Account</span>
              <span className="text-sm font-bold text-navy-deep leading-none truncate max-w-[120px]">{user.displayName || user.email}</span>
            </div>
          )}

          <div className="hidden sm:flex flex-col items-end">
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1 text-right w-full">Temperatura</span>
            <span className="text-lg font-bold text-navy-deep leading-none">3.2°C</span>
          </div>
          
          {user && (
            <button 
              onClick={handleLogout}
              className="w-10 h-10 neumorphic-raised rounded-full flex items-center justify-center text-slate-400 hover:text-rose-500 hover:scale-110 active:scale-95 transition-transform"
              title="Logout"
            >
              <LogOut size={20} />
            </button>
          )}

          {view !== 'list' && (
             <button 
              onClick={() => { setView('list'); }}
              className="w-10 h-10 neumorphic-raised rounded-full flex items-center justify-center text-navy-deep hover:scale-110 active:scale-95 transition-transform"
            >
              <X size={20} />
            </button>
          )}
        </div>
      </nav>

      <main className="max-w-5xl mx-auto p-4 md:p-8 relative z-10 pt-12 md:pt-20">
        <AnimatePresence mode="wait">
          {authLoading ? (
            <motion.div
              key="auth-loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center py-40"
            >
              <RefreshCw className="w-12 h-12 text-indigo-500 animate-spin mb-6" />
              <p className="text-slate-400 font-bold uppercase tracking-widest text-xs">Caricamento account...</p>
            </motion.div>
          ) : !user ? (
            <motion.div 
              key="login"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="max-w-md mx-auto py-12 px-8 bg-indigo-600 rounded-[3rem] text-center space-y-8 shadow-2xl"
            >
              <div className="w-24 h-24 bg-white/20 backdrop-blur-md rounded-[2rem] mx-auto flex items-center justify-center text-white">
                <Refrigerator size={48} />
              </div>
              <div>
                <h2 className="text-3xl font-display font-black text-white tracking-tight">Benvenuto</h2>
                <p className="text-indigo-100 text-sm mt-3 font-medium">Accedi per sincronizzare il tuo frigo su tutti i tuoi dispositivi e non scordare più nulla.</p>
              </div>
              <button 
                onClick={handleLogin}
                className="w-full py-5 bg-white rounded-3xl font-bold flex items-center justify-center gap-4 hover:scale-[1.02] active:scale-95 transition-all shadow-xl"
              >
                <LogIn size={20} className="text-orange-500" />
                <span className="tracking-widest uppercase text-sm text-orange-500">Accedi con Google</span>
              </button>
              <p className="text-[10px] text-indigo-200 font-black uppercase tracking-[0.2em]">Zero configurazione • Sincronizzazione AI</p>
            </motion.div>
          ) : (
            <>
              {view === 'list' && (
                <motion.div 
                  key="list"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="space-y-6 md:space-y-8"
                >
                  <div className="flex flex-col md:flex-row items-end md:items-center justify-between gap-6 pb-2">
                    <div className="hidden lg:block">
                      <h2 className="text-4xl font-display font-bold text-navy-deep tracking-tight">Il mio Frigo</h2>
                      {user && (
                        <p className="text-[10px] font-black text-indigo-500 uppercase tracking-[0.2em] mt-1">
                          {user.displayName || user.email}
                        </p>
                      )}
                      <p className="text-slate-500 text-sm mt-2 font-medium">Gestisci la tua dispensa con intelligenza artificiale.</p>
                    </div>
                  </div>

              <div className="grid grid-cols-2 gap-4 md:gap-6 mb-10 md:mb-12">
                <div className="neumorphic-raised px-5 pt-7 pb-8 md:px-8 md:pt-8 md:pb-10 rounded-[2rem] md:rounded-[2.5rem] flex flex-col items-start gap-1 md:gap-2">
                  <span className="text-[9px] md:text-[10px] font-black text-rose-500 uppercase tracking-[0.2em] md:tracking-widest truncate w-full">Critici</span>
                  <span className="text-4xl md:text-5xl font-display font-bold text-navy-deep leading-[1.1]">{expiredCount}</span>
                </div>
                <div className="neumorphic-raised px-5 pt-7 pb-8 md:px-8 md:pt-8 md:pb-10 rounded-[2rem] md:rounded-[2.5rem] flex flex-col items-start gap-1 md:gap-2">
                  <span className="text-[9px] md:text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] md:tracking-widest truncate w-full">Totali</span>
                  <span className="text-4xl md:text-5xl font-display font-bold text-navy-deep leading-[1.1]">{products.length}</span>
                </div>
              </div>
              {/* Toolbar & Add Item */}
              <div className="flex flex-col gap-6">
                <div className="neumorphic-raised bg-white rounded-[2.5rem] p-6 border border-blue-50 flex flex-col gap-4">
                  <div className="flex items-center gap-3 px-2">
                    <Search className="text-blue-500" size={20} />
                    <span className="font-black uppercase tracking-widest text-[10px] text-blue-500">Cerca nel Frigo</span>
                  </div>
                  <div className="relative">
                    <input 
                      type="text" 
                      placeholder="Filtra inventario..."
                      className="w-full neumorphic-inset px-6 py-4 rounded-2xl focus:outline-none transition-all font-medium text-navy-deep placeholder:text-slate-400 border-none text-base"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              {/* Product List Dashboard */}
              <div className="w-full pb-20">
                {/* Header for desktop */}
                <div className="hidden lg:grid grid-cols-[80px_1fr_150px_150px_150px] gap-4 px-8 mb-4 text-slate-400 text-[10px] font-black uppercase tracking-[0.2em]">
                  <div className="pl-2"></div>
                  <div>Dettaglio</div>
                  <div>Categoria</div>
                  <div className="text-center">Scadenza</div>
                  <div className="text-right">Azioni</div>
                </div>

                <div className="space-y-4">
                  <AnimatePresence mode="popLayout">
                    {sortedProducts.length === 0 ? (
                      <motion.div 
                        key="empty"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="py-24 text-center neumorphic-raised rounded-[2.5rem]"
                      >
                        <div className="max-w-xs mx-auto">
                          <Search className="text-slate-300 mx-auto mb-6" size={48} />
                          <p className="text-navy-deep font-bold text-xl uppercase tracking-widest">Frigo Vuoto</p>
                          <p className="text-slate-400 text-xs mt-3 uppercase tracking-widest font-black">Inizia aggiungendo prodotti</p>
                        </div>
                      </motion.div>
                    ) : (
                      sortedProducts.map((product) => {
                        const statusClasses = getStatusClasses(product);
                        return (
                          <motion.div 
                            key={product.id} 
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, filter: 'blur(10px)' }}
                            layout
                            className={cn(
                              "neumorphic-raised rounded-[2rem] md:rounded-[2.5rem] p-4 md:p-6 transition-all hover:scale-[1.01]",
                              product.consumed ? "bg-slate-800 text-slate-400 shadow-none border-none grayscale-[0.3]" : "bg-white"
                            )}
                          >
                            <div className="flex flex-col lg:flex-row lg:items-center gap-4 lg:gap-0">
                            {/* Primary info row */}
                            <div className="flex items-center gap-4 lg:w-[calc(80px+1fr)]">
                              <div className="shrink-0">
                                <button 
                                  onClick={() => toggleConsumed(product.id)}
                                  className={cn(
                                    "w-8 h-8 rounded-xl transition-all flex items-center justify-center relative",
                                    product.consumed ? "bg-indigo-500 text-white shadow-inner" : "neumorphic-raised text-slate-400 hover:text-indigo-500"
                                  )}
                                >
                                  {product.consumed ? (
                                    <motion.div
                                      initial={{ scale: 0.5, opacity: 0 }}
                                      animate={{ scale: 1, opacity: 1 }}
                                    >
                                      <Check size={18} className="stroke-[3]" />
                                    </motion.div>
                                  ) : (
                                    <Square size={18} className="opacity-20" />
                                  )}
                                </button>
                              </div>

                              <div className="flex items-center gap-4 md:gap-6 min-w-0 flex-1">
                                <div className={cn(
                                  "w-12 h-12 md:w-16 md:h-16 rounded-2xl flex items-center justify-center shrink-0 neumorphic-inset text-xl md:text-2xl transition-all",
                                  product.consumed ? "opacity-30 grayscale" : (
                                    statusClasses.includes('rose') ? 'text-rose-500' :
                                    statusClasses.includes('amber') ? 'text-amber-500' :
                                    'text-indigo-500'
                                  )
                                )}>
                                  {getCategoryIcon(product.category)}
                                </div>
                                <div className="min-w-0 flex-1 pr-2">
                                  <div className="relative group">
                                    <div className={cn(
                                      "font-black leading-tight text-xs md:text-sm transition-all duration-500 relative block break-words whitespace-normal max-w-full",
                                      product.consumed ? "text-slate-500" : "text-navy-deep"
                                    )}>
                                      {product.name}
                                      {product.consumed && (
                                        <motion.div 
                                          initial={{ width: 0 }}
                                          animate={{ width: '100%' }}
                                          className="absolute left-0 top-1/2 h-[2px] bg-slate-600 -translate-y-1/2"
                                        />
                                      )}
                                    </div>
                                  </div>
                                  {/* Progress bar on mobile/tablet */}
                                  <div className={cn("lg:hidden mt-2 w-24 md:w-32 transition-opacity", product.consumed && "opacity-0")}>
                                    <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden shadow-inner">
                                      <motion.div 
                                        initial={{ width: 0 }}
                                        animate={{ width: `${getExpiryProgress(product.addedDate, product.expiryDate)}%` }}
                                        className={cn(
                                          "h-full transition-colors",
                                          statusClasses.includes('rose') ? "bg-rose-500" :
                                          statusClasses.includes('amber') ? "bg-amber-500" :
                                          "bg-indigo-500"
                                        )}
                                      />
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>

                            {/* Secondary info row/column */}
                            <div className="flex items-center justify-between lg:contents">
                              <div className="hidden lg:block lg:w-[150px] px-2 text-center">
                                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest neumorphic-inset px-4 py-2 rounded-xl">
                                  {product.category}
                                </span>
                              </div>

                              {/* Desktop Progress bar */}
                              <div className="hidden lg:block lg:w-[150px] px-4">
                                <div className="h-2 bg-slate-200 rounded-full overflow-hidden shadow-inner">
                                  <motion.div 
                                    initial={{ width: 0 }}
                                    animate={{ width: `${getExpiryProgress(product.addedDate, product.expiryDate)}%` }}
                                    className={cn(
                                      "h-full transition-colors",
                                      statusClasses.includes('rose') ? "bg-rose-500" :
                                      statusClasses.includes('amber') ? "bg-amber-500" :
                                      "bg-indigo-500"
                                    )}
                                  />
                                </div>
                              </div>

                              <div className="flex-1 lg:flex-none lg:w-[150px] flex justify-center lg:px-4">
                                <div className={cn(
                                  "inline-flex px-3 md:px-4 py-1.5 md:py-2 text-[10px] md:text-xs font-black rounded-xl md:rounded-2xl uppercase tracking-[0.1em] neumorphic-inset min-w-[90px] md:min-w-[110px] justify-center items-center shadow-sm",
                                  statusClasses.includes('rose') ? "text-rose-500" :
                                  statusClasses.includes('amber') ? "text-amber-600" :
                                  "text-slate-400"
                                )}>
                                  {renderDate(product.expiryDate, 'dd MMM yy')}
                                </div>
                              </div>

                              <div className="flex items-center justify-end gap-2 md:gap-3 lg:w-[150px] lg:pl-4">
                                <button 
                                  onClick={() => editProduct(product)}
                                  className="w-10 h-10 md:w-11 md:h-11 neumorphic-raised rounded-xl md:rounded-2xl text-slate-400 hover:text-indigo-500 flex items-center justify-center transition-all active:scale-95"
                                >
                                  <Edit3 size={18} />
                                </button>
                                <button 
                                  onClick={() => removeProduct(product.id)}
                                  className="w-10 h-10 md:w-11 md:h-11 neumorphic-raised rounded-xl md:rounded-2xl text-orange-500 hover:text-orange-700 flex items-center justify-center transition-all active:scale-95"
                                >
                                  <Trash2 size={18} />
                                </button>
                              </div>
                            </div>
                          </div>
                        </motion.div>
                      );
                    })
                  )}
                  </AnimatePresence>
                </div>
              </div>

            </motion.div>
          )}
          {view === 'settings' && (
            <motion.div 
              key="settings"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="max-w-2xl mx-auto space-y-8 relative z-10"
            >
              <div className="flex items-center justify-between mb-8">
                <div>
                  <h2 className="text-4xl font-display font-bold text-navy-deep tracking-tight">Impostazioni Notifiche</h2>
                  <p className="text-slate-500 text-sm mt-2 font-medium">Personalizza come vuoi essere avvisato.</p>
                </div>
              </div>

              <div className="neumorphic-raised rounded-[3rem] p-10 space-y-12">
                {/* Notice Days */}
                <div className="space-y-6">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 neumorphic-raised rounded-2xl flex items-center justify-center text-indigo-500">
                      <Bell size={24} />
                    </div>
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Anticipo Avviso</label>
                  </div>
                  <div className="grid grid-cols-3 gap-6">
                    {[1, 3, 7].map((days) => (
                      <button
                        key={days}
                        onClick={() => {
                          playMuffledClick();
                          updateNotificationSettings({ ...notificationSettings, daysBefore: days });
                        }}
                        className={cn(
                          "py-6 rounded-3xl font-display font-bold text-base transition-all",
                          notificationSettings.daysBefore === days 
                            ? "neumorphic-inset text-indigo-600 scale-95" 
                            : "neumorphic-raised text-slate-500 hover:text-slate-700"
                        )}
                      >
                        {days} {days === 1 ? 'Giorno' : 'Giorni'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Categories Management Wheel */}
                <div className="space-y-6">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 neumorphic-raised rounded-2xl flex items-center justify-center text-indigo-500">
                      <Search size={24} />
                    </div>
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Gestione Categorie</label>
                  </div>
                  
                  <CategorySettingsWheel 
                    categories={notificationSettings.allCategories || []}
                    enabledCategories={notificationSettings.enabledCategories}
                    onToggle={(cat) => {
                      playMuffledClick();
                      const isEnabled = notificationSettings.enabledCategories.includes(cat);
                      const newCats = isEnabled 
                        ? notificationSettings.enabledCategories.filter(c => c !== cat)
                        : [...notificationSettings.enabledCategories, cat];
                      updateNotificationSettings({ ...notificationSettings, enabledCategories: newCats });
                    }}
                    onEdit={editCategory}
                    onDelete={(cat) => setDeletingCategory(cat)}
                    onAdd={addNewCategory}
                    audioEnabled={audioEnabled}
                    playMuffledClick={playMuffledClick}
                    deletingCategory={deletingCategory}
                    setDeletingCategory={setDeletingCategory}
                    removeCategory={removeCategory}
                  />
                </div>

                {/* Gemini API Key */}
                <div className="space-y-6 pt-6 border-t border-slate-100">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 neumorphic-raised rounded-2xl flex items-center justify-center text-indigo-500">
                        <Sparkles size={24} />
                      </div>
                      <div>
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Gemini API Key</label>
                        <p className="text-[9px] text-slate-400 mt-0.5">Necessaria per le funzioni AI avanzate</p>
                      </div>
                    </div>
                    <a 
                      href="https://aistudio.google.com/app/apikey" 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-[10px] font-black text-indigo-500 uppercase tracking-widest hover:underline flex items-center gap-1"
                    >
                      Ottieni Chiave <ChevronRight size={10} />
                    </a>
                  </div>
                  <div className="relative">
                    <input 
                      type="password" 
                      placeholder="Inserisci la tua API Key..."
                      value={notificationSettings.geminiApiKey || ''}
                      onChange={(e) => updateNotificationSettings({ ...notificationSettings, geminiApiKey: e.target.value })}
                      className="w-full neumorphic-inset px-8 py-5 rounded-3xl focus:outline-none transition-all font-medium text-navy-deep placeholder:text-slate-400 border-none text-base"
                    />
                  </div>
                </div>
              </div>
            </motion.div>
          )}


          {view === 'shopping' && (
            <motion.div 
              key="shopping"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="max-w-2xl mx-auto space-y-8 relative z-10"
            >
              <div className="flex items-center justify-between mb-8">
                <div>
                  <h2 className="text-4xl font-display font-bold text-navy-deep tracking-tight">Lista Spesa</h2>
                  <p className="text-slate-500 text-sm mt-2 font-medium">Suggerimenti intelligenti per la tua dispensa.</p>
                </div>
              </div>

              <div className="flex flex-col gap-4">
                <div className="flex gap-4">
                  <button 
                    onClick={() => {
                      playMuffledClick();
                      generateAIShoppingList();
                    }}
                    disabled={loading}
                    className="flex-1 py-5 neumorphic-raised hover:scale-[1.02] active:scale-95 disabled:opacity-50 text-indigo-600 rounded-2xl font-bold flex items-center justify-center gap-3 transition-all group"
                  >
                    {loading ? <RefreshCw className="animate-spin" size={20} /> : <Sparkles className="group-hover:rotate-12 transition-transform" size={20} />}
                    <span className="tracking-widest uppercase text-xs">Genera con AI</span>
                  </button>
                  <button 
                    onClick={() => {
                      playMuffledClick();
                      clearShoppingItems();
                    }}
                    className="px-8 py-5 neumorphic-raised text-orange-500 hover:text-orange-700 rounded-2xl font-bold transition-all"
                  >
                    <Trash2 size={20} />
                  </button>
                </div>

                <div className="neumorphic-raised bg-white rounded-[2rem] p-4 border border-blue-50 flex gap-2">
                  <input 
                    type="text" 
                    placeholder="Aggiungi prodotto manualmente..."
                    className="flex-1 neumorphic-inset px-6 py-3 rounded-xl focus:outline-none transition-all font-medium text-navy-deep placeholder:text-slate-400 border-none text-sm"
                    value={newManualShoppingItem}
                    onChange={(e) => setNewManualShoppingItem(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        addManualShoppingItem();
                      }
                    }}
                  />
                  <button 
                    onClick={() => {
                      playMuffledClick();
                      addManualShoppingItem();
                    }}
                    disabled={addingManual || !newManualShoppingItem.trim()}
                    className="w-12 h-12 neumorphic-raised rounded-xl text-indigo-600 flex items-center justify-center hover:scale-105 active:scale-95 transition-all disabled:opacity-50"
                  >
                    {addingManual ? <RefreshCw className="animate-spin" size={18} /> : <Plus size={20} />}
                  </button>
                </div>
              </div>

              <div className="neumorphic-raised rounded-[2.5rem] overflow-hidden p-2">
                {shoppingItems.length === 0 ? (
                  <div className="py-24 text-center px-10">
                    <div className="w-20 h-20 neumorphic-inset rounded-full flex items-center justify-center mx-auto mb-8 text-slate-300">
                      <ShoppingBag size={32} />
                    </div>
                    <p className="text-navy-deep font-bold text-xl">Lista vuota</p>
                    <p className="text-slate-400 text-sm mt-2">Analizza i prodotti mancanti per iniziare.</p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {shoppingItems.map(item => (
                      <div 
                        key={item.id}
                        className={cn(
                          "px-8 py-6 flex items-center justify-between group transition-all border-l-[3px] border-transparent hover:border-indigo-400",
                          item.checked ? "opacity-40" : "hover:bg-slate-50/50"
                        )}
                      >
                        <div className="flex items-center gap-5">
                          <button 
                            onClick={() => toggleCheckShoppingItem(item.id)}
                            className={cn(
                              "w-6 h-6 rounded-lg transition-all flex items-center justify-center border-2",
                              item.checked ? "bg-indigo-500 border-indigo-500 shadow-lg shadow-indigo-500/20" : "neumorphic-raised border-transparent"
                            )}
                          >
                            {item.checked && <Check size={12} className="text-white stroke-[3]" />}
                          </button>
                          <div>
                            <p className={cn("font-bold text-navy-deep", item.checked && "line-through text-slate-400")}>
                              {item.name}
                            </p>
                            <div className="flex items-center gap-3 mt-1.5">
                              <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{item.category}</span>
                              <div className="w-1 h-1 bg-slate-300 rounded-full" />
                              <span className={cn(
                                "text-[9px] font-black uppercase tracking-widest",
                                item.source === 'recipe' ? "text-indigo-400" : 
                                item.source === 'finished' ? "text-rose-400" : "text-slate-400"
                              )}>
                                {item.source === 'recipe' ? "Ricetta" : 
                                 item.source === 'finished' ? "Finito" : "Manuale"}
                              </span>
                            </div>
                          </div>
                        </div>
                        <button 
                          onClick={() => removeShoppingItem(item.id)}
                          className="w-10 h-10 neumorphic-raised rounded-xl text-orange-500 hover:text-orange-700 flex items-center justify-center transition-all opacity-0 group-hover:opacity-100"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          )}

              {view === 'camera' && (
                <CameraScanner 
                  onCapture={handleCapture}
                  onClose={() => {
                    setView(isScanningDate ? 'confirm' : 'list');
                    setIsScanningDate(false);
                  }}
                  loading={loading}
                  isScanningDate={isScanningDate}
                />
              )}

          {view === 'confirm' && scannedInfo && (
            <motion.div 
              key="confirm"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="max-w-2xl mx-auto py-6 sm:py-10 px-4 sm:px-0"
            >
              <div className="neumorphic-raised rounded-3xl sm:rounded-[3.5rem] p-6 sm:p-10 space-y-8 sm:space-y-12 relative z-10">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h2 className="text-2xl sm:text-4xl font-display font-bold text-navy-deep tracking-tight">
                      {isEditing ? "Modifica" : "Nuovo Prodotto"}
                    </h2>
                  </div>
                  <div className="w-14 h-14 sm:w-20 sm:h-20 neumorphic-raised rounded-2xl sm:rounded-3xl flex items-center justify-center text-indigo-500 shrink-0">
                    {scannedInfo.category ? getCategoryIcon(scannedInfo.category) : <Refrigerator size={24} className="sm:w-8 sm:h-8" />}
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-6 sm:gap-10">
                  <div className="space-y-6 sm:space-y-8">
                    <div className="space-y-2 sm:space-y-3">
                      <label className="text-[10px] text-slate-400 uppercase font-bold tracking-widest px-2">Nome Prodotto</label>
                      <input 
                        type="text" 
                        value={scannedInfo.name}
                        onChange={(e) => setScannedInfo({ ...scannedInfo, name: e.target.value })}
                        className="w-full neumorphic-inset px-5 sm:px-6 py-4 sm:py-5 rounded-xl font-bold text-navy-deep text-base transition-all outline-none border-none placeholder:text-slate-300"
                        placeholder="Nome prodotto"
                      />
                    </div>

                    <div className="space-y-2 sm:space-y-3">
                      <div className="flex items-center justify-between px-2">
                        <label className="text-[10px] text-slate-400 uppercase font-bold tracking-widest">Categoria</label>
                        <button 
                          onClick={() => setIsAddingCategory(!isAddingCategory)}
                          className="text-[10px] font-black text-indigo-500 uppercase tracking-widest hover:underline"
                        >
                          {isAddingCategory ? "Annulla" : "Nuova"}
                        </button>
                      </div>
                      
                      {isAddingCategory ? (
                        <div className="flex gap-2">
                          <input 
                            type="text" 
                            autoFocus
                            placeholder="Nome categoria..."
                            value={newCategoryName}
                            onChange={(e) => setNewCategoryName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') addNewCategory(newCategoryName);
                            }}
                            className="flex-1 neumorphic-inset px-5 py-4 rounded-xl font-bold text-navy-deep text-base transition-all outline-none border-none"
                          />
                          <button 
                            onClick={() => addNewCategory(newCategoryName)}
                            className="w-12 h-12 neumorphic-raised text-indigo-500 rounded-xl flex items-center justify-center transition-all active:scale-95"
                          >
                            <Plus size={20} />
                          </button>
                        </div>
                      ) : (
                        <CategoryWheelPicker 
                          categories={notificationSettings.allCategories || []}
                          value={scannedInfo.category || 'Altro'}
                          onChange={(val) => setScannedInfo({ ...scannedInfo, category: val })}
                          audioEnabled={audioEnabled}
                        />
                      )}
                    </div>
                  </div>

                  <div className="space-y-6 sm:space-y-8">
                    <div className="space-y-2 sm:space-y-3">
                      <label className="text-[10px] text-slate-400 uppercase font-bold tracking-widest px-2">Data Scadenza</label>
                      <div className="flex gap-2 items-stretch">
                        <input 
                          type="date" 
                          value={scannedInfo.expiryDate}
                          onChange={(e) => setScannedInfo({ ...scannedInfo, expiryDate: e.target.value })}
                          className="flex-1 neumorphic-inset px-4 sm:px-6 py-4 sm:py-5 rounded-xl font-bold text-navy-deep text-base transition-all outline-none border-none [color-scheme:light] min-w-0"
                        />
                        <button 
                          type="button"
                          onClick={startExpiryDateScan}
                          className="w-14 sm:w-16 neumorphic-raised text-orange-500 rounded-xl flex items-center justify-center transition-all active:scale-95 group shrink-0"
                          title="Scansiona data"
                        >
                          <Camera size={20} className="sm:w-5.5 sm:h-5.5 group-hover:scale-110 transition-transform" />
                        </button>
                        <button 
                          type="button"
                          onClick={startVoiceInput}
                          className={cn(
                            "w-14 sm:w-16 neumorphic-raised rounded-xl flex items-center justify-center transition-all active:scale-95 group shrink-0",
                            isListening ? "text-orange-500 neumorphic-inset" : "text-indigo-600"
                          )}
                          title="Dettatura vocale"
                        >
                          {isListening ? <Mic size={20} className="sm:w-5.5 sm:h-5.5 animate-pulse" /> : <Mic size={20} className="sm:w-5.5 sm:h-5.5 group-hover:scale-110 transition-transform" />}
                        </button>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <label className="text-[10px] text-slate-400 uppercase font-bold tracking-widest px-2">Avviso Anticipato</label>
                      <div className="relative">
                        <select 
                          value={(scannedInfo.customReminderDays === undefined || scannedInfo.customReminderDays === null) ? "" : scannedInfo.customReminderDays}
                          onChange={(e) => {
                            const val = e.target.value === "" ? null : parseInt(e.target.value);
                            let newExpiry = scannedInfo.expiryDate;
                            if (val !== null && scannedInfo.expiryDate) {
                              const d = parseISO(scannedInfo.expiryDate);
                              if (isValid(d)) {
                                newExpiry = format(addDays(d, val), 'yyyy-MM-dd');
                              }
                            }
                            setScannedInfo({ 
                              ...scannedInfo, 
                              customReminderDays: val,
                              expiryDate: newExpiry
                            });
                          }}
                          className="w-full neumorphic-inset px-6 py-5 rounded-3xl font-bold text-navy-deep transition-all outline-none appearance-none cursor-pointer border-none"
                        >
                          <option value="">Default</option>
                          <option value="1">1 giorno</option>
                          <option value="2">2 giorni</option>
                          <option value="3">3 giorni</option>
                          <option value="5">5 giorni</option>
                          <option value="7">1 settimana</option>
                        </select>
                        <div className="absolute right-6 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                          <ChevronRight size={18} className="rotate-90" />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="pt-8 flex flex-col sm:flex-row gap-6">
                  <button 
                    onClick={() => {
                      playMuffledClick();
                      addProduct(scannedInfo);
                    }}
                    className="w-full py-6 neumorphic-raised text-orange-500 hover:text-orange-600 rounded-3xl flex items-center justify-center transition-all active:scale-95 group shadow-[0_10px_20px_rgba(249,115,22,0.15)]"
                    title={isEditing ? "Aggiorna" : "Salva Prodotto"}
                  >
                    <Save size={28} className="group-hover:scale-110 transition-transform" />
                  </button>
                </div>
              </div>
            </motion.div>
          )}
          </>
        )}
      </AnimatePresence>

        <AnimatePresence>
          {showReminder && expiringSoonProducts.length > 0 && (
            <ExpiringReminderModal 
              products={expiringSoonProducts} 
              allProducts={products.filter(p => !p.consumed)}
              onClose={() => setShowReminder(false)} 
              onIngredientsSuggested={(ingredients) => setLastSuggestedIngredients(prev => [...new Set([...prev, ...ingredients])])}
            />
          )}
        </AnimatePresence>
      </main>

      <footer className="w-full max-w-7xl mx-auto px-10 pt-20 pb-48 mt-24 border-t border-slate-200 text-center">
        <div className="flex flex-col items-center justify-center gap-12">
          <div className="flex flex-col items-center gap-6 group">
            <div className="w-14 h-14 rounded-3xl neumorphic-raised flex items-center justify-center text-indigo-500 group-hover:scale-110 transition-transform">
              <Refrigerator className="w-7 h-7" />
            </div>
            <div>
              <h3 className="text-lg font-display font-black tracking-widest text-navy-deep uppercase leading-none">FRIGOSMART</h3>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-[0.2em] mt-2">Personal Assistant AI</p>
            </div>
          </div>
          
        <div className="flex flex-col items-center gap-6">
          <div className="text-center">
              <p className="text-[10px] text-slate-300 font-bold uppercase tracking-widest mb-1">Tecnologia</p>
              <div className="flex items-center justify-center gap-2 text-slate-500 font-bold text-xs">
                <span>Gemini 3 Flash</span>
                <Sparkles size={12} className="text-indigo-400" />
              </div>
            </div>
            
            <div className="flex items-center justify-center gap-4">
              <button 
                onClick={() => {
                  setAudioEnabled(!audioEnabled);
                  playMuffledClick();
                }}
                className={cn(
                  "w-10 h-10 rounded-xl neumorphic-raised flex items-center justify-center transition-all active:scale-95",
                  audioEnabled ? "text-orange-500" : "text-slate-400"
                )}
                title={audioEnabled ? "Disattiva audio" : "Attiva audio"}
              >
                {audioEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
              </button>
              {[Bell, ShoppingBag, RefreshCw].map((Icon, idx) => (
                <a key={idx} href="#" className="w-10 h-10 neumorphic-raised rounded-xl flex items-center justify-center text-slate-400 hover:text-indigo-500 transition-all">
                  <Icon size={18} />
                </a>
              ))}
            </div>
          </div>

          <div className="flex flex-col items-center gap-2 mt-4">
             <p className="text-xs font-black tracking-[0.3em] text-indigo-500 uppercase">CASTRO MASSIMO BY DEVTOOLS</p>
             <a 
               href="mailto:castromassimo@gmail.com" 
               className="text-[10px] font-bold text-slate-400 tracking-widest uppercase hover:text-indigo-500 transition-all duration-300 flex items-center gap-2 group/email"
             >
               <Mail size={10} className="text-slate-300 group-hover/email:text-indigo-400 transition-colors" />
               castromassimo@gmail.com
             </a>
          </div>
        </div>
        
        <div className="mt-20 flex flex-col items-center justify-center gap-6 pt-10 border-t border-slate-100">
          <p className="text-[9px] text-slate-400 font-bold uppercase tracking-[0.2em]">
            © 2026 FRIGOSMART AI · Precision Engineering
          </p>
          <div className="flex gap-8">
            <a href="#" className="text-[9px] text-slate-400 hover:text-indigo-500 font-bold uppercase tracking-[0.2em] transition-colors">Privacy</a>
            <a href="#" className="text-[9px] text-slate-400 hover:text-indigo-500 font-bold uppercase tracking-[0.2em] transition-colors">Legal</a>
          </div>
        </div>
      </footer>

      {/* Floating Bottom Navigation Navbar */}
      <AnimatePresence>
        {(view === 'list' || view === 'settings' || view === 'shopping') && (
          <motion.div 
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            className="fixed bottom-6 left-4 right-4 md:bottom-10 md:left-1/2 md:-translate-x-1/2 md:right-auto z-50"
          >
            <div className="neumorphic-raised rounded-[2.5rem] px-2 sm:px-6 py-2 sm:py-3 flex items-center justify-around md:justify-center md:gap-6 border border-white/40 bg-[#E0E5EC]/80 backdrop-blur-sm min-w-[300px] md:min-w-0">
              <button 
                onClick={() => {
                  playMechanicalClick();
                  setView('list');
                }}
                className={cn(
                   "w-10 h-10 sm:w-14 sm:h-14 rounded-xl sm:rounded-2xl transition-all group relative neumorphic-raised flex items-center justify-center",
                    view === 'list' ? "neumorphic-inset text-orange-500 scale-95" : "text-indigo-600 hover:text-indigo-800 active:scale-95"
                )}
                title="Dispensa"
              >
                <Refrigerator size={20} className={cn("sm:w-6 sm:h-6", view === 'list' ? "opacity-100" : "opacity-60")} />
              </button>

              <button 
                onClick={() => {
                  playMechanicalClick();
                  setView('shopping');
                }}
                className={cn(
                   "w-10 h-10 sm:w-14 sm:h-14 rounded-xl sm:rounded-2xl transition-all group relative neumorphic-raised flex items-center justify-center",
                    view === 'shopping' ? "neumorphic-inset text-orange-500 scale-95" : "text-indigo-600 hover:text-indigo-800 active:scale-95"
                )}
                title="Lista Spesa"
              >
                <ShoppingBag size={20} className={cn("sm:w-6 sm:h-6", view === 'shopping' ? "opacity-100" : "opacity-60")} />
              </button>

              <button 
                onClick={() => {
                  playMechanicalClick();
                  startCamera();
                }}
                className="w-12 h-12 sm:w-16 sm:h-16 neumorphic-raised text-orange-500 rounded-xl sm:rounded-2xl transition-all flex items-center justify-center hover:scale-105 active:neumorphic-inset active:scale-95 group"
                title="Prodotti"
              >
                <Camera size={24} className="sm:w-7 sm:h-7 group-hover:scale-110 transition-transform" />
              </button>

              <button 
                onClick={() => {
                  playMechanicalClick();
                  startManualEntry();
                }}
                className="w-10 h-10 sm:w-14 sm:h-14 neumorphic-raised text-indigo-600 rounded-xl sm:rounded-2xl transition-all flex items-center justify-center hover:scale-105 active:neumorphic-inset active:scale-95 group"
                title="Aggiungi Manualmente"
              >
                <Plus size={24} className="sm:w-7 sm:h-7 group-hover:scale-110 transition-transform" />
              </button>

              <button 
                onClick={() => {
                  playMechanicalClick();
                  setView('settings');
                }}
                className={cn(
                   "w-10 h-10 sm:w-14 sm:h-14 rounded-xl sm:rounded-2xl transition-all group neumorphic-raised flex items-center justify-center",
                   view === 'settings' ? "neumorphic-inset text-orange-500 scale-95" : "text-indigo-600 hover:text-indigo-800 active:scale-95"
                )}
                title="Impostazioni"
              >
                <Settings size={20} className={cn("sm:w-6 sm:h-6 transition-transform duration-700", view === 'settings' ? "rotate-90" : "group-hover:rotate-45")} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Global CSS for animations */}
      <style>{`
        @keyframes scan {
          0%, 100% { top: 0; opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          50% { top: 100%; }
        }
        .animate-scan {
          animation: scan 4s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}

interface CameraScannerProps {
  onCapture: (base64: string) => void;
  onClose: () => void;
  loading: boolean;
  isScanningDate?: boolean;
}

function CameraScanner({ onCapture, onClose, loading, isScanningDate }: CameraScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [videoStarted, setVideoStarted] = useState(false);
  const [retryTrigger, setRetryTrigger] = useState(0);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        onCapture(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  useEffect(() => {
    let mounted = true;

    const initCam = async (retryWithSimple = false) => {
      try {
        setError(null);
        setVideoStarted(false);
        const constraints = retryWithSimple ? { video: true } : { 
          video: { 
            facingMode: 'environment',
            width: { ideal: 1280 },
            height: { ideal: 720 }
          } 
        };

        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error("Browser non supportato (Secure Context richiesto)");
        }

        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        
        if (!mounted) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.setAttribute('playsinline', 'true');
          videoRef.current.setAttribute('autoplay', 'true');
          videoRef.current.setAttribute('muted', 'true');
          
          try {
            await videoRef.current.load();
            await videoRef.current.play();
            setVideoStarted(true);
          } catch (e) {
            console.warn("Autoplay interaction needed", e);
            setVideoStarted(true);
          }
        }
      } catch (err: any) {
        console.error("Camera access error:", err);
        if (!retryWithSimple && err.name !== 'NotAllowedError') {
          initCam(true);
          return;
        }
        
        if (mounted) {
          let msg = "Impossibile accedere alla fotocamera.";
          if (err.name === 'NotAllowedError' || err.name === 'SecurityError') {
            msg = "Accesso bloccato dal browser. Verifica i permessi o apri in una nuova scheda.";
          } else if (err.name === 'NotFoundError') {
            msg = "Fotocamera non trovata.";
          }
          setError(msg);
        }
      }
    };

    initCam();

    return () => {
      mounted = false;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
    };
  }, [onClose, retryTrigger]);

  const handleCapture = () => {
    if (!videoRef.current || !canvasRef.current || !streamRef.current) return;
    const context = canvasRef.current.getContext('2d');
    if (!context) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    // Resize for AI analysis: max 1024px while keeping aspect ratio
    const MAX_DIM = 1024;
    let width = video.videoWidth;
    let height = video.videoHeight;
    
    if (width > height) {
      if (width > MAX_DIM) {
        height *= MAX_DIM / width;
        width = MAX_DIM;
      }
    } else {
      if (height > MAX_DIM) {
        width *= MAX_DIM / height;
        height = MAX_DIM;
      }
    }

    canvas.width = width;
    canvas.height = height;
    context.drawImage(video, 0, 0, width, height);
    
    // Use slightly lower quality (0.7) to speed up upload/analysis
    onCapture(canvas.toDataURL('image/jpeg', 0.7));
  };

  return (
    <motion.div 
      key="camera"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-ice-grey flex flex-col items-center justify-center p-4 md:p-12"
    >
      <div className="relative w-full max-w-5xl h-full md:h-[85vh] neumorphic-raised rounded-[3.5rem] overflow-hidden p-4">
        <div className="relative w-full h-full rounded-[2.5rem] overflow-hidden bg-navy-deep">
          {error ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center gap-6">
              <div className="w-20 h-20 neumorphic-raised rounded-3xl flex items-center justify-center text-rose-500 bg-navy-deep">
                <AlertCircle size={40} />
              </div>
              <div className="space-y-4 max-w-md">
                <p className="text-white font-display font-bold text-xl leading-tight">
                  {error}
                </p>
                <div className="flex flex-col gap-3">
                  <button 
                    onClick={() => setRetryTrigger(prev => prev + 1)}
                    className="py-4 px-6 bg-white text-navy-deep rounded-2xl font-bold text-sm uppercase tracking-widest neumorphic-raised hover:scale-105 transition-all active:scale-95"
                  >
                    Riprova
                  </button>
                  <button 
                    onClick={() => window.open(window.location.href, '_blank')}
                    className="py-4 px-6 bg-indigo-600 text-white rounded-2xl font-bold text-sm uppercase tracking-widest hover:bg-indigo-500 transition-all active:scale-95 shadow-lg shadow-indigo-500/30"
                  >
                    Apri in nuova scheda
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="relative w-full h-full">
              <video 
                ref={videoRef} 
                autoPlay 
                playsInline 
                muted
                onLoadedMetadata={() => setVideoStarted(true)}
                className={cn(
                  "w-full h-full object-cover transition-opacity duration-500",
                  videoStarted ? "opacity-100" : "opacity-0"
                )}
              />
              {!videoStarted && (
                <div className="absolute inset-0 flex flex-col items-center justify-center z-10 bg-navy-deep">
                  <div className="w-12 h-12 border-4 border-white/20 border-t-indigo-500 rounded-full animate-spin"></div>
                  {/* Text removed */}
                </div>
              )}
            </div>
          )}
          
          {!error && videoStarted && (
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <div className="w-[60vw] h-[60vw] max-w-[280px] max-h-[280px] border-2 border-white/20 rounded-[3rem] relative overflow-hidden">
                <div className="absolute inset-x-0 h-1 bg-white/40 shadow-[0_0_25px_rgba(255,255,255,0.6)] animate-scan"></div>
              </div>

              {/* Text removed */}
            </div>
          )}
        </div>
        
        <div className="absolute bottom-12 inset-x-0 flex justify-center items-center px-10 gap-8">
          <button 
            onClick={() => fileInputRef.current?.click()}
            className="w-16 h-16 neumorphic-raised text-slate-500 rounded-full flex items-center justify-center active:scale-95 transition-all"
            title="Sfoglia Gallery"
          >
            <Plus size={24} />
          </button>

          <button 
            onClick={handleCapture}
            disabled={loading || !videoStarted}
            className="w-24 h-24 neumorphic-raised bg-white text-navy-deep rounded-full flex items-center justify-center active:neumorphic-inset active:scale-95 transition-all group"
          >
            {loading ? (
              <RefreshCw className="animate-spin" size={32} />
            ) : (
              <Camera size={40} className="group-hover:scale-110 transition-transform" />
            )}
          </button>

          <button 
            onClick={onClose}
            className="w-16 h-16 neumorphic-raised text-rose-500 rounded-full flex items-center justify-center active:scale-95 transition-all"
          >
            <X size={24} />
          </button>
        </div>
      </div>

      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleFileSelect} 
        accept="image/*" 
        className="hidden" 
      />
      <canvas ref={canvasRef} className="hidden" />
    </motion.div>
  );
}

function CategorySettingsWheel({ 
  categories, 
  enabledCategories, 
  onToggle, 
  onEdit, 
  onDelete, 
  onAdd,
  deletingCategory,
  setDeletingCategory,
  removeCategory,
  audioEnabled,
  playMuffledClick
}: { 
  categories: string[], 
  enabledCategories: string[], 
  onToggle: (cat: string) => void,
  onEdit: (oldName: string, newName?: string) => void,
  onDelete: (cat: string) => void,
  onAdd: (name: string) => void,
  deletingCategory: string | null,
  setDeletingCategory: (cat: string | null) => void,
  removeCategory: (cat: string) => void,
  audioEnabled: boolean,
  playMuffledClick: () => void
}) {
  const [activeCat, setActiveCat] = useState(categories[0] || 'Altro');
  const [isAddingInWheel, setIsAddingInWheel] = useState(false);
  const [isEditingInWheel, setIsEditingInWheel] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [editingCatName, setEditingCatName] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  const playTick = () => {
    if (!audioEnabled) return;
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const ctx = audioContextRef.current;
      if (ctx.state === 'suspended') ctx.resume();
      
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(150, ctx.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + 0.1);

      gainNode.gain.setValueAtTime(0.1, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);

      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);

      oscillator.start();
      oscillator.stop(ctx.currentTime + 0.1);
    } catch (e) {
      console.error("Audio failed", e);
    }
  };

  useEffect(() => {
    if (!categories.includes(activeCat) && categories.length > 0) {
      setActiveCat(categories[0]);
    }
  }, [categories, activeCat]);

  const onScroll = () => {
    if (!containerRef.current) return;
    const scrollTop = containerRef.current.scrollTop;
    const index = Math.round(scrollTop / 60);
    if (categories[index] && categories[index] !== activeCat) {
      setActiveCat(categories[index]);
      playTick();
    }
  };

  const isEnabled = enabledCategories.includes(activeCat);

  return (
    <div className="space-y-8">
      <div className="relative h-[240px] w-full neumorphic-inset rounded-[3rem] overflow-hidden bg-slate-100/30">
        <div className="absolute top-1/2 left-0 right-0 h-[60px] -translate-y-1/2 pointer-events-none z-10 border-y border-indigo-500/10 bg-white/40 shadow-sm" />
        
        <div 
          ref={containerRef}
          onScroll={onScroll}
          className="h-full w-full overflow-y-auto scroll-smooth snap-y snap-mandatory no-scrollbar"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          <div className="h-[90px]" aria-hidden="true" />
          {categories.map((cat) => (
            <div 
              key={cat} 
              onClick={() => {
                 if (containerRef.current) {
                   playMuffledClick();
                   const index = categories.indexOf(cat);
                   containerRef.current.scrollTo({ top: index * 60, behavior: 'smooth' });
                   setActiveCat(cat);
                 }
              }}
              className="h-[60px] flex items-center justify-center snap-center cursor-pointer"
            >
              <span className={cn(
                "text-sm font-black uppercase tracking-[0.2em] transition-all duration-300",
                activeCat === cat ? "text-navy-deep" : "text-slate-300 opacity-40"
              )}>
                {cat}
              </span>
            </div>
          ))}
          <div className="h-[90px]" aria-hidden="true" />
        </div>
      </div>

      <div className="relative">
        <AnimatePresence mode="wait">
          {isAddingInWheel ? (
            <motion.div 
              key="add-category"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="neumorphic-raised rounded-[2.5rem] p-8 space-y-6"
            >
              <div>
                <p className="font-black uppercase tracking-widest text-[10px] opacity-60 mb-2">Nuova Categoria</p>
                <input 
                  type="text"
                  autoFocus
                  placeholder="Nome categoria..."
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      onAdd(newCatName);
                      setIsAddingInWheel(false);
                      setNewCatName('');
                    }
                  }}
                  className="w-full neumorphic-inset px-6 py-4 rounded-xl font-bold text-navy-deep text-base outline-none border-none"
                />
              </div>
              <div className="flex gap-4">
                <button 
                  onClick={() => {
                    if (newCatName.trim()) {
                      onAdd(newCatName.trim());
                      setIsAddingInWheel(false);
                      setNewCatName('');
                    }
                  }}
                  disabled={!newCatName.trim()}
                  className={cn(
                    "flex-1 py-5 rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-xl active:scale-95 transition-all",
                    newCatName.trim() 
                      ? "bg-indigo-600 text-white shadow-indigo-500/20" 
                      : "bg-slate-200 text-slate-400 cursor-not-allowed opacity-60"
                  )}
                >
                  Aggiungi
                </button>
                <button 
                  onClick={() => {
                    setIsAddingInWheel(false);
                    setNewCatName('');
                  }}
                  className="flex-1 py-5 neumorphic-raised text-slate-500 rounded-2xl font-black uppercase tracking-widest text-[10px] active:scale-95 transition-all hover:bg-slate-50"
                >
                  Annulla
                </button>
              </div>
            </motion.div>
          ) : isEditingInWheel ? (
            <motion.div 
              key="edit-category"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="neumorphic-raised rounded-[2.5rem] p-8 space-y-6"
            >
              <div>
                <p className="font-black uppercase tracking-widest text-[10px] opacity-60 mb-2">Rinomina Categoria</p>
                <input 
                  type="text"
                  autoFocus
                  placeholder="Nome categoria..."
                  value={editingCatName}
                  onChange={(e) => setEditingCatName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && editingCatName.trim() && editingCatName.trim() !== activeCat) {
                      onEdit(activeCat, editingCatName.trim());
                      setIsEditingInWheel(false);
                      playMuffledClick();
                    }
                  }}
                  className="w-full neumorphic-inset px-6 py-4 rounded-xl font-bold text-navy-deep text-base outline-none border-none"
                />
              </div>
              <div className="flex gap-4">
                <button 
                  onClick={() => {
                    if (editingCatName.trim() && editingCatName.trim() !== activeCat) {
                      onEdit(activeCat, editingCatName.trim());
                      setIsEditingInWheel(false);
                      playMuffledClick();
                    }
                  }}
                  disabled={!editingCatName.trim() || editingCatName.trim() === activeCat}
                  className={cn(
                    "flex-1 py-5 rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-xl active:scale-95 transition-all text-white",
                    (editingCatName.trim() && editingCatName.trim() !== activeCat)
                      ? "bg-indigo-600 shadow-indigo-500/20" 
                      : "bg-slate-200 text-slate-400 cursor-not-allowed opacity-60"
                  )}
                >
                  Salva
                </button>
                <button 
                  onClick={() => {
                    setIsEditingInWheel(false);
                    playMuffledClick();
                  }}
                  className="flex-1 py-5 neumorphic-raised text-slate-500 rounded-2xl font-black uppercase tracking-widest text-[10px] active:scale-95 transition-all hover:bg-slate-50"
                >
                  Annulla
                </button>
              </div>
            </motion.div>
          ) : deletingCategory === activeCat ? (
            <motion.div 
              key="delete-confirm"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="neumorphic-raised rounded-[2.5rem] bg-white p-8 flex flex-col items-center gap-6 text-center border border-blue-50"
            >
              <div>
                <p className="font-black uppercase tracking-widest text-[10px] text-blue-500 mb-2">Conferma Eliminazione</p>
                <h3 className="text-xl font-bold tracking-tight text-blue-600">Vuoi eliminare "{activeCat}"?</h3>
              </div>
              <div className="flex gap-4 w-full">
                <button 
                  onClick={() => {
                    playMuffledClick();
                    removeCategory(activeCat);
                  }}
                  className="flex-1 py-5 bg-blue-600 text-white rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-lg shadow-blue-200 active:scale-95 transition-all"
                >
                  Sì, Elimina
                </button>
                <button 
                  onClick={() => {
                    playMuffledClick();
                    setDeletingCategory(null);
                  }}
                  className="flex-1 py-5 bg-slate-100 text-slate-500 rounded-2xl font-black uppercase tracking-widest text-[10px] active:scale-95 transition-all"
                >
                  Annulla
                </button>
              </div>
            </motion.div>
          ) : (
            <motion.div 
              key="actions"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <div className="flex items-center gap-4">
                <button 
                  onClick={() => {
                    playMuffledClick();
                    onToggle(activeCat);
                  }}
                  className={cn(
                    "flex-1 py-6 rounded-[2.5rem] font-black text-[10px] uppercase tracking-widest flex items-center justify-center gap-3 transition-all",
                    isEnabled 
                      ? "neumorphic-inset text-blue-600 bg-blue-50/50" 
                      : "neumorphic-raised text-indigo-500 hover:text-indigo-600 hover:bg-slate-50"
                  )}
                >
                  <div className={cn(
                    "w-6 h-6 rounded-lg flex items-center justify-center border-2 transition-all",
                    isEnabled ? "bg-blue-500 border-blue-500" : "border-slate-300"
                  )}>
                    {isEnabled && <Check size={12} className="text-white stroke-[4]" />}
                  </div>
                  Mostra
                </button>

                <div className="flex gap-4">
                  <button 
                    onClick={() => {
                      playMuffledClick();
                      setEditingCatName(activeCat);
                      setIsEditingInWheel(true);
                    }}
                    className="w-16 h-16 neumorphic-raised rounded-[1.5rem] flex items-center justify-center text-slate-500 hover:text-indigo-500 hover:scale-105 transition-all"
                    title="Modifica"
                  >
                    <Edit3 size={24} />
                  </button>
                  <button 
                    onClick={() => {
                      playMuffledClick();
                      onDelete(activeCat);
                    }}
                    className="w-16 h-16 neumorphic-raised rounded-[1.5rem] flex items-center justify-center text-orange-500 hover:text-orange-700 hover:scale-105 transition-all"
                    title="Elimina"
                  >
                    <Trash2 size={24} />
                  </button>
                </div>
              </div>

              <button 
                onClick={() => {
                  playMuffledClick();
                  setIsAddingInWheel(true);
                }}
                className="w-full py-6 neumorphic-raised rounded-[2.5rem] text-indigo-500 font-black text-[10px] uppercase tracking-widest flex items-center justify-center gap-2 hover:scale-[1.01] active:scale-95 transition-all bg-white"
              >
                <Plus size={20} />
                Nuova Categoria
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function CategoryWheelPicker({ 
  categories, 
  value, 
  onChange,
  audioEnabled
}: { 
  categories: string[], 
  value: string, 
  onChange: (val: string) => void,
  audioEnabled: boolean
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  const playTick = () => {
    if (!audioEnabled) return;
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const ctx = audioContextRef.current;
      if (ctx.state === 'suspended') ctx.resume();
      
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(180, ctx.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(60, ctx.currentTime + 0.08);

      gainNode.gain.setValueAtTime(0.08, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.08);

      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);

      oscillator.start();
      oscillator.stop(ctx.currentTime + 0.08);
    } catch (e) {
      console.error("Audio failed", e);
    }
  };

  // Center the initial value
  useEffect(() => {
    if (containerRef.current) {
      const index = categories.indexOf(value);
      if (index !== -1) {
        // We wait a bit for layout
        setTimeout(() => {
          if (containerRef.current) {
            containerRef.current.scrollTo({
              top: index * 50,
              behavior: 'smooth'
            });
          }
        }, 100);
      }
    }
  }, [categories]);

  const onScroll = () => {
    if (!containerRef.current) return;
    const scrollTop = containerRef.current.scrollTop;
    const index = Math.round(scrollTop / 50);
    if (categories[index] && categories[index] !== value) {
      onChange(categories[index]);
      playTick();
    }
  };

  return (
    <div className="relative h-[150px] w-full neumorphic-inset rounded-2xl overflow-hidden bg-slate-100/30">
      {/* Center Highlight bar */}
      <div className="absolute top-1/2 left-0 right-0 h-[50px] -translate-y-1/2 pointer-events-none z-10 border-y border-indigo-500/10 bg-white/40 shadow-sm" />
      
      <div 
        ref={containerRef}
        onScroll={onScroll}
        className="h-full w-full overflow-y-auto scroll-smooth snap-y snap-mandatory no-scrollbar"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        <div className="h-[50px]" aria-hidden="true" /> {/* Spacer */}
        {categories.map((cat) => (
          <div 
            key={cat} 
            onClick={() => {
              if (containerRef.current) {
                const index = categories.indexOf(cat);
                containerRef.current.scrollTo({
                  top: index * 50,
                  behavior: 'smooth'
                });
                onChange(cat);
              }
            }}
            className="h-[50px] flex items-center justify-center snap-center cursor-pointer"
          >
            <span className={cn(
              "text-[10px] font-black uppercase tracking-[0.2em] transition-all duration-300",
              value === cat ? "text-indigo-600" : "text-slate-400 opacity-30"
            )}>
              {cat}
            </span>
          </div>
        ))}
        <div className="h-[50px]" aria-hidden="true" /> {/* Spacer */}
      </div>
    </div>
  );
}

function ExpiringReminderModal({ 
  products, 
  allProducts, 
  onClose,
  onIngredientsSuggested
}: { 
  products: Product[], 
  allProducts: Product[], 
  onClose: () => void,
  onIngredientsSuggested: (ingredients: string[]) => void
}) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [recipeInfo, setRecipeInfo] = useState<RecipeInfo | null>(null);
  const [loadingRecipe, setLoadingRecipe] = useState(false);
  const [mode, setMode] = useState<'individual' | 'combined'>('individual');
  
  const currentProduct = products[currentIndex];

  useEffect(() => {
    setRecipeInfo(null);
  }, [currentIndex, mode]);

  const handleGetRecipe = async () => {
    setLoadingRecipe(true);
    try {
      const expiringList = mode === 'individual' 
        ? [{ name: currentProduct.name, category: currentProduct.category }]
        : products.map(p => ({ name: p.name, category: p.category }));

      // Other products excluding the ones we are focusing on
      const focusedIds = mode === 'individual' ? [currentProduct.id] : products.map(p => p.id);
      const otherProducts = allProducts
        .filter(p => !focusedIds.includes(p.id))
        .map(p => ({ name: p.name, category: p.category }));

      const info = await generateRecipeSuggestion(expiringList, otherProducts);
      setRecipeInfo(info);
      if (info.pairingIngredients) {
        onIngredientsSuggested(info.pairingIngredients);
      }
    } catch (e) {
      setRecipeInfo({
        recipe: "Prepara una spadellata mista gourmet con i tuoi prodotti in scadenza, aggiungendo erbe aromatiche e un tocco di formaggio.",
        pairingIngredients: ["Olio EVO", "Aglio", "Prezzemolo"],
        alternatives: ["Frittata svuota-frigo", "Mix al forno croccante"]
      });
    } finally {
      setLoadingRecipe(false);
    }
  };

  const next = () => setCurrentIndex((prev) => (prev + 1) % products.length);
  const prev = () => setCurrentIndex((prev) => (prev - 1 + products.length) % products.length);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/80 backdrop-blur-md"
      />
      <motion.div 
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 20 }}
        className="relative w-full max-w-lg neumorphic-raised rounded-[3rem] overflow-hidden"
      >
        <button 
          onClick={onClose}
          className="absolute top-8 right-8 z-10 w-10 h-10 neumorphic-raised rounded-full flex items-center justify-center text-slate-400 hover:text-rose-500 transition-colors"
        >
          <X size={18} />
        </button>

        <div className="p-10 pb-6">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 neumorphic-inset rounded-2xl flex items-center justify-center text-indigo-500">
                <Refrigerator size={24} />
              </div>
              <div>
                <h3 className="text-xl font-display font-bold text-navy-deep leading-none">Chef AI</h3>
                <p className="text-[9px] text-slate-400 font-black uppercase tracking-[0.2em] mt-1.5">Anti-Spreco</p>
              </div>
            </div>

            <div className="flex neumorphic-inset p-1.5 rounded-2xl">
              <button 
                onClick={() => setMode('individual')}
                className={cn(
                  "px-4 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all",
                  mode === 'individual' ? "neumorphic-raised text-indigo-600" : "text-slate-400 hover:text-slate-600"
                )}
              >
                Singolo
              </button>
              <button 
                onClick={() => setMode('combined')}
                className={cn(
                  "px-4 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all",
                  mode === 'combined' ? "neumorphic-raised text-indigo-600" : "text-slate-400 hover:text-slate-600"
                )}
              >
                Combo
              </button>
            </div>
          </div>

          <div className="relative">
            <AnimatePresence mode="wait">
              <motion.div 
                key={mode === 'individual' ? currentProduct.id : 'combined'}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="neumorphic-inset rounded-[2.5rem] p-8"
              >
                {mode === 'individual' ? (
                  <div className="flex items-start justify-between gap-4 mb-6">
                    <div className="flex-1">
                      <span className="text-[9px] font-black text-rose-500 uppercase tracking-widest mb-1.5 block">Da consumare</span>
                      <h4 className="text-2xl font-display font-bold text-navy-deep truncate">{currentProduct.name}</h4>
                      <p className="text-slate-400 text-xs mt-1.5 font-medium">
                        Scade il {format(parseISO(currentProduct.expiryDate), 'd MMMM', { locale: it })}
                      </p>
                    </div>
                    <div className="w-14 h-14 neumorphic-raised rounded-2xl flex items-center justify-center text-slate-400">
                      {getCategoryIcon(currentProduct.category)}
                    </div>
                  </div>
                ) : (
                  <div className="mb-6">
                    <span className="text-[9px] font-black text-rose-500 uppercase tracking-widest mb-3 block">Ingredienti Combinati</span>
                    <div className="flex flex-wrap gap-2 mb-4">
                      {products.map(p => (
                        <span key={p.id} className="px-3 py-2 neumorphic-raised rounded-xl text-[10px] font-bold text-navy-deep">
                          + {p.name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="mt-8 min-h-[140px]">
                  {loadingRecipe ? (
                    <div className="flex flex-col items-center justify-center h-full gap-5 py-10">
                      <RefreshCw className="animate-spin text-indigo-400" size={32} />
                      <p className="text-[9px] text-slate-400 uppercase font-black tracking-widest">Creazione ricetta gourmet...</p>
                    </div>
                  ) : recipeInfo ? (
                    <motion.div 
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="space-y-6"
                    >
                      <div className="bg-white/50 rounded-[2rem] p-6 border border-white/40">
                        <div className="flex gap-4">
                          <CookingPot size={22} className="text-indigo-500 shrink-0 mt-1" />
                          <div className="space-y-5">
                            <p className="text-sm text-navy-deep leading-relaxed font-semibold">
                              {recipeInfo.recipe}
                            </p>
                            
                            {recipeInfo.pairingIngredients && recipeInfo.pairingIngredients.length > 0 && (
                              <div>
                                <span className="text-[9px] font-black text-slate-300 uppercase tracking-widest block mb-3">Abbinamenti consigliati</span>
                                <div className="flex flex-wrap gap-2">
                                  {recipeInfo.pairingIngredients.map((ing, i) => (
                                    <span key={i} className="px-3 py-2 neumorphic-raised rounded-xl text-[10px] font-bold text-indigo-600">
                                      {ing}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  ) : (
                    <button 
                      onClick={handleGetRecipe}
                      className="w-full py-6 neumorphic-raised text-indigo-600 rounded-3xl font-black text-xs uppercase tracking-[0.2em] transition-all hover:scale-[1.02] active:scale-95 flex items-center justify-center gap-3"
                    >
                      <CookingPot size={20} />
                      Genera Ricetta
                    </button>
                  )}
                </div>
              </motion.div>
            </AnimatePresence>

            {mode === 'individual' && products.length > 1 && (
              <div className="flex justify-between items-center mt-8 px-4">
                <div className="flex gap-2.5">
                  {products.map((_, idx) => (
                    <div 
                      key={idx}
                      className={`h-1.5 rounded-full transition-all duration-300 ${idx === currentIndex ? 'w-8 bg-indigo-500 shadow-lg shadow-indigo-500/20' : 'w-1.5 bg-slate-200'}`}
                    />
                  ))}
                </div>
                <div className="flex gap-4">
                  <button 
                    onClick={prev}
                    className="w-12 h-12 neumorphic-raised rounded-2xl flex items-center justify-center text-slate-400 hover:text-navy-deep transition-all"
                  >
                    <ChevronLeft size={20} />
                  </button>
                  <button 
                    onClick={next}
                    className="w-12 h-12 neumorphic-raised rounded-2xl flex items-center justify-center text-slate-400 hover:text-navy-deep transition-all"
                  >
                    <ChevronRight size={20} />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="p-10 pt-4">
          <button 
            onClick={onClose}
            className="w-full py-6 neumorphic-raised bg-white text-navy-deep rounded-3xl font-black text-xs uppercase tracking-widest transition-all active:neumorphic-inset"
          >
            Ricevuto
          </button>
        </div>
      </motion.div>
    </div>
  );
}

