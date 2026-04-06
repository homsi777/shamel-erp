
import React, { useState, useEffect, useRef } from 'react';
import { Check, ChevronsUpDown, Plus } from 'lucide-react';

interface ComboboxProps {
  items: { id: string; label: string; subLabel?: string }[];
  selectedId: string;
  onSelect: (id: string, name?: string) => void;
  onAddNew?: (name: string) => void;
  onNext?: () => void; // Function to move to next input
  inputProps?: React.InputHTMLAttributes<HTMLInputElement> & {
    'data-line-index'?: number | string;
    'data-field-index'?: number | string;
  };
  placeholder?: string;
  allowCustomValue?: boolean;
  clearSelectionOnType?: boolean;
  label?: string;
  autoFocus?: boolean;
  showAllOnFocus?: boolean;
}

const Combobox: React.FC<ComboboxProps> = ({ 
  items, selectedId, onSelect, onAddNew, onNext, inputProps, placeholder = "ابحث...", allowCustomValue = false, clearSelectionOnType = false, label, autoFocus, showAllOnFocus = false
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedItem = items.find(item => item.id === selectedId);

  useEffect(() => {
    // نحدث النص فقط إذا تم اختيار مادة موجودة بالفعل
    if (selectedItem) {
      setSearchTerm(selectedItem.label);
    } 
    // حذفنا التصفير التلقائي (searchTerm = '') عند إغلاق القائمة لنحافظ على ما كتبه المستخدم
  }, [selectedId, items]); // نراقب الـ selectedId فقط

  useEffect(() => {
    if(autoFocus && inputRef.current) {
        inputRef.current.focus();
    }
  }, [autoFocus]);

  const filteredItems = items.filter(item =>
    item.label.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (item.subLabel && item.subLabel.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const handleSelect = (id: string, label: string) => {
    onSelect(id, label);
    setSearchTerm(label);
    setIsOpen(false);
    if (onNext) onNext();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIsOpen(true);
      setHighlightedIndex(prev => Math.min(prev + 1, filteredItems.length - 1 + (allowCustomValue || onAddNew ? 1 : 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIsOpen(true);
      setHighlightedIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredItems.length > 0 && highlightedIndex < filteredItems.length) {
        const item = filteredItems[highlightedIndex];
        handleSelect(item.id, item.label);
      } else if ((allowCustomValue || onAddNew) && searchTerm.trim() !== '') {
          // الحفاظ على النص عند الإضافة
          if (allowCustomValue) {
             onSelect('', searchTerm);
             setIsOpen(false);
             if (onNext) onNext();
          } else if (onAddNew) {
             onAddNew(searchTerm);
             setIsOpen(false);
          }
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
    setIsOpen(true);
    setHighlightedIndex(0);
    if (allowCustomValue) {
        onSelect('', e.target.value); 
    } else if (clearSelectionOnType && selectedId) {
        onSelect('', e.target.value);
    } else {
         // لا نصفر الـ selectedId فوراً للسماح للمستخدم بإكمال كتابة اسم جديد
         // onSelect(''); 
    }
  };

  const inputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    handleKeyDown(e);
    inputProps?.onKeyDown?.(e);
  };

  const inputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleChange(e);
    inputProps?.onChange?.(e);
  };
  const openDropdown = () => {
    if (showAllOnFocus) {
      setSearchTerm('');
      setHighlightedIndex(0);
    }
    setIsOpen(true);
  };

  return (
    <div className="relative" ref={wrapperRef}>
      {label && <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>}
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          className="w-full border rounded-lg p-2.5 pl-3 pr-10 focus:ring-2 focus:ring-primary focus:outline-none font-bold text-gray-800 min-h-[44px]"
          placeholder={placeholder}
          value={searchTerm}
          onChange={inputChange}
          onKeyDown={inputKeyDown}
          onFocus={openDropdown}
          onClick={openDropdown}
          autoComplete="off"
          {...inputProps}
        />
        <div className="absolute left-3 top-2.5 text-gray-400">
          <ChevronsUpDown size={16} />
        </div>
      </div>

      {isOpen && (searchTerm || filteredItems.length > 0) && (
        <ul className="absolute z-[500] w-full mt-1 bg-white border rounded-lg shadow-lg max-h-60 overflow-auto text-right android-scroll-safe">
          {filteredItems.map((item, index) => (
            <li
              key={item.id}
              onClick={() => handleSelect(item.id, item.label)}
              className={`px-4 py-2.5 min-h-[40px] cursor-pointer flex justify-between items-center gap-3 tap-feedback ${index === highlightedIndex ? 'bg-blue-100 text-blue-800' : 'hover:bg-gray-100 text-gray-700'} ${selectedId === item.id ? 'font-bold' : ''}`}
            >
              <div className="min-w-0">
                <div className="font-bold text-sm truncate">{item.label}</div>
                {item.subLabel && <div className="text-[10px] text-gray-400 font-mono truncate">{item.subLabel}</div>}
              </div>
              {selectedId === item.id && <Check size={16} />}
            </li>
          ))}
          
          {filteredItems.length === 0 && !allowCustomValue && onAddNew && (
            <li 
              className={`px-4 py-3 cursor-pointer font-bold flex items-center gap-2 border-t ${highlightedIndex === filteredItems.length ? 'bg-gray-100' : ''}`}
              onClick={() => { onAddNew(searchTerm); setIsOpen(false); }}
            >
              <Plus size={16} /> إضافة "{searchTerm}" كمادة جديدة
            </li>
          )}

          {filteredItems.length === 0 && allowCustomValue && (
             <li className="px-4 py-2 text-gray-500 text-sm">
                اضغط Enter لاستخدام "{searchTerm}"
             </li>
          )}
        </ul>
      )}
    </div>
  );
};

export default Combobox;
