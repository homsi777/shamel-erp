
import React, { useState, useEffect, useRef } from 'react';
import { Check, ChevronsUpDown, Plus } from 'lucide-react';

interface ComboboxProps {
  items: { id: string; label: string; subLabel?: string }[];
  selectedId: string;
  onSelect: (id: string, name?: string) => void;
  onAddNew?: (name: string) => void;
  onNext?: () => void; // Function to move to next input
  placeholder?: string;
  allowCustomValue?: boolean;
  label?: string;
  autoFocus?: boolean;
}

const Combobox: React.FC<ComboboxProps> = ({ 
  items, selectedId, onSelect, onAddNew, onNext, placeholder = "بحث...", allowCustomValue = false, label, autoFocus 
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedItem = items.find(item => item.id === selectedId);

  useEffect(() => {
    if (selectedItem) {
      setSearchTerm(selectedItem.label);
    } else if (!allowCustomValue && !isOpen) {
      setSearchTerm('');
    }
  }, [selectedItem, allowCustomValue, isOpen]);

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

  const handleKeyDown = (e: React.KeyboardEvent) => {
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
          // Custom value or Add New
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
    } else {
        onSelect(''); 
    }
  };

  return (
    <div className="relative" ref={wrapperRef}>
      {label && <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>}
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          className="w-full border rounded-lg p-2 pl-3 pr-10 focus:ring-2 focus:ring-primary focus:outline-none font-bold text-gray-800"
          placeholder={placeholder}
          value={searchTerm}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsOpen(true)}
          onClick={() => setIsOpen(true)}
          autoComplete="off"
        />
        <div className="absolute left-3 top-2.5 text-gray-400">
          <ChevronsUpDown size={16} />
        </div>
      </div>

      {isOpen && (searchTerm || filteredItems.length > 0) && (
        <ul className="absolute z-50 w-full mt-1 bg-white border rounded-lg shadow-lg max-h-60 overflow-auto">
          {filteredItems.map((item, index) => (
            <li
              key={item.id}
              onClick={() => handleSelect(item.id, item.label)}
              className={`px-4 py-2 cursor-pointer flex justify-between items-center ${index === highlightedIndex ? 'bg-blue-100 text-blue-800' : 'hover:bg-gray-100 text-gray-700'} ${selectedId === item.id ? 'font-bold' : ''}`}
            >
              <div>
                <div>{item.label}</div>
                {item.subLabel && <div className="text-xs text-gray-400">{item.subLabel}</div>}
              </div>
              {selectedId === item.id && <Check size={16} />}
            </li>
          ))}
          
          {filteredItems.length === 0 && !allowCustomValue && onAddNew && (
            <li 
              className={`px-4 py-3 cursor-pointer font-bold flex items-center gap-2 border-t ${highlightedIndex === filteredItems.length ? 'bg-gray-100' : ''}`}
              onClick={() => { onAddNew(searchTerm); setIsOpen(false); }}
            >
              <Plus size={16} /> إضافة "{searchTerm}"
            </li>
          )}

          {filteredItems.length === 0 && allowCustomValue && (
             <li className="px-4 py-2 text-gray-500 text-sm">
                اضغط Enter لإضافة "{searchTerm}" كمادة جديدة
             </li>
          )}
        </ul>
      )}
    </div>
  );
};

export default Combobox;
