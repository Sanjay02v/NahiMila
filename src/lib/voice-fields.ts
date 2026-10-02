import { getFutureDateString } from './constants';
// Suggestions require explicit evidence. Missing fields stay blank for merchant review.
export function suggestVoiceFields(transcript:string){
 const text=transcript.toLowerCase();const fields:{productId?:string;quantity?:number;price?:number;deadline?:string}={};
 const masala=/masala|मसाला/.test(text),lime=/lime|नींबू/.test(text),hundred=/(?:100\s*(?:g\b|gram|gm|ग्राम))/.test(text),twoHundred=/(?:200\s*(?:g\b|gram|gm|ग्राम))/.test(text);
 if(/millet|मिलेट/.test(text)){if(masala&&twoHundred)fields.productId='prod-millet-200';else if(masala&&hundred)fields.productId='prod-millet';else if(lime&&hundred)fields.productId='prod-millet-lime';}
 const quantity=text.match(/(?:quantity|qty|मात्रा)\s*[:=]?\s*(\d+)\b/)||text.match(/\b(\d+)\s*(?:packets?|packs?|units?|पैकेट)/);
 if(quantity&&Number(quantity[1])>0)fields.quantity=Number(quantity[1]);
 const price=text.match(/(?:₹|rs\.?|rupees?|budget|under|below|बजट)\s*[:=]?\s*(\d+(?:\.\d{1,2})?)/)||text.match(/(\d+(?:\.\d{1,2})?)\s*(?:rupees?|रुपये|ke andar)/);
 if(price&&Number(price[1])>0)fields.price=Number(price[1]);
 if(/day after tomorrow|परसों|parson/.test(text))fields.deadline=getFutureDateString(2);
 else if(/tomorrow|कल|\bkal\b/.test(text))fields.deadline=getFutureDateString(1);
 return fields;
}
